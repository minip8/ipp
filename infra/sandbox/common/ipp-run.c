/*
 * ipp-run: the in-sandbox supervisor for the interview++ judge.
 *
 * Every process the judge starts inside a sandbox container is started through this program
 * (via `docker exec`), and the container's PID 1 is this program in --idle mode.
 *
 *   ipp-run --idle
 *       PID 1. Reaps orphans forever; exits on SIGTERM/SIGINT.
 *
 *   ipp-run [options] -- program [args...]
 *       Runs `program` with resource limits and relays its I/O over a framed protocol on this
 *       process's stdin/stdout. Afterwards every process of the sandbox uid is killed, so nothing
 *       the program started survives it.
 *
 * Protocol. Every frame is [u8 type][u32 big-endian length][length bytes].
 *   judge -> ipp-run (stdin):   'D' bytes for the program's input fd
 *                               'C' close the program's input
 *                               'K' kill the program (and every other process of this uid)
 *   ipp-run -> judge (stdout):  'O' program stdout bytes
 *                               'E' program stderr bytes
 *                               'X' final status, one JSON object; always the last frame
 *   EOF on stdin means the judge went away: everything is killed.
 *
 * Options:
 *   --in-fd N        install the input pipe at fd N in the program (default 0). With N != 0 the
 *                    program's stdin is /dev/null. N = -1: no input pipe at all.
 *   --wall-ms N      kill after N ms of wall-clock time (0 = no limit)
 *   --cpu-s N        RLIMIT_CPU (soft N, hard N+1)
 *   --stack-mb N     RLIMIT_STACK
 *   --fsize-mb N     RLIMIT_FSIZE
 *   --nofile N       RLIMIT_NOFILE
 *   --max-output N   kill once the program has produced more than N bytes on stdout+stderr
 *                    (the first N bytes are relayed)
 *   --nproc N        RLIMIT_NPROC: tasks (processes + threads) of the sandbox uid. Only meaningful
 *                    under gVisor, where every sandbox has its own kernel and so its own count;
 *                    under runc the count is shared by every container on the host (the judge
 *                    relies on the pids cgroup there and does not pass this).
 *   --max-rss-mb N   kill once the resident memory of all sandbox processes (except this one and
 *                    PID 1) adds up to more than N MiB. Polled every 50 ms, every 10 ms once over
 *                    half of N (a scan costs ~0.4 ms of the sandbox's CPU under gVisor, ~0.05 ms
 *                    under runc). This catches memory over-use inside the sandbox, well before the
 *                    container's cgroup limit: under gVisor reaching that limit makes the host kill
 *                    the whole sandbox.
 *   --max-files N    kill once the tmpfs mounts (/work, /dev/shm) hold more than N inodes, or more
 *                    than they held at the start if that was already over N. gVisor ignores the
 *                    tmpfs nr_inodes option, and every inode costs it ~1 KiB of its own memory.
 *   --cwd DIR        working directory for the program
 *
 * The status JSON: {"exitCode":int|null,"signal":int|null,"wallMs":num,"cpuMs":num,
 *   "maxRssKb":int,"peakRssKb":int,"oomKilled":bool,"memoryLimit":bool,"fileLimit":bool,
 *   "timedOut":bool,"outputLimit":bool,"killed":bool,"spawnError":string|null}
 * maxRssKb: largest single process (rusage); peakRssKb: largest polled total (0 if not polled).
 */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/statvfs.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define BUF_SIZE 65536

static int sigchld_pipe[2] = {-1, -1};
static pid_t child = -1;
static int child_done = 0;
static int child_status = 0;
static struct rusage child_ru;

static void die(const char *msg) {
    dprintf(2, "ipp-run: %s: %s\n", msg, strerror(errno));
    _exit(125);
}

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

static void on_sigchld(int sig) {
    (void)sig;
    int saved = errno;
    if (sigchld_pipe[1] >= 0) {
        char c = 0;
        ssize_t r = write(sigchld_pipe[1], &c, 1);
        (void)r;
    }
    errno = saved;
}

static void on_term(int sig) {
    (void)sig;
    _exit(0);
}

/* Reap every exited descendant (we are a child subreaper); remember the main child's status. */
static void reap(void) {
    for (;;) {
        int st;
        struct rusage ru;
        pid_t p = wait4(-1, &st, WNOHANG, &ru);
        if (p <= 0) return;
        if (p == child) {
            child_done = 1;
            child_status = st;
            child_ru = ru;
        }
    }
}

/* SIGKILL every process this uid can signal (except ourselves and PID 1) until none is left. */
static void kill_all(void) {
    for (int i = 0; i < 2000; i++) {
        int r = kill(-1, SIGKILL);
        int e = errno;
        reap();
        if (r == -1 && e == ESRCH) return;
        if (i > 0) usleep(500);
    }
}

_Noreturn static void idle_main(void) {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_term;
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);
    sa.sa_handler = on_sigchld;
    sa.sa_flags = SA_NOCLDSTOP;
    sigaction(SIGCHLD, &sa, NULL);
    for (;;) {
        int st;
        pid_t p = waitpid(-1, &st, 0);
        if (p < 0 && errno == ECHILD) pause();
    }
}

static void write_all(int fd, const void *buf, size_t n) {
    const char *p = buf;
    while (n > 0) {
        ssize_t w = write(fd, p, n);
        if (w < 0) {
            if (errno == EINTR) continue;
            if (errno == EAGAIN) {
                struct pollfd pfd = {fd, POLLOUT, 0};
                poll(&pfd, 1, 100);
                continue;
            }
            /* The judge is gone; nothing useful left to do. */
            kill_all();
            _exit(124);
        }
        p += w;
        n -= (size_t)w;
    }
}

static void send_frame(char type, const void *data, uint32_t len) {
    unsigned char hdr[5] = {(unsigned char)type, (unsigned char)(len >> 24), (unsigned char)(len >> 16),
                            (unsigned char)(len >> 8), (unsigned char)len};
    write_all(1, hdr, 5);
    if (len) write_all(1, data, len);
}

static long read_oom_kills(void) {
    int fd = open("/sys/fs/cgroup/memory.events", O_RDONLY | O_CLOEXEC);
    if (fd < 0) return -1;
    char buf[1024];
    ssize_t n = read(fd, buf, sizeof buf - 1);
    close(fd);
    if (n <= 0) return -1;
    buf[n] = 0;
    char *p = strstr(buf, "oom_kill ");
    if (!p) return -1;
    return strtol(p + 9, NULL, 10);
}

/* Resident memory (KiB) of every process in the sandbox except this one and PID 1. Both runtimes
 * give the container its own PID namespace, so /proc lists only sandbox processes; threads share
 * their process's memory and are not listed separately. Pages shared between processes (after a
 * fork) are counted once per process, which can only overstate the total. */
static long long sandbox_rss_kb(DIR *proc, long page_kb) {
    long long total = 0;
    pid_t self = getpid();
    rewinddir(proc);
    struct dirent *de;
    char path[64], buf[128];
    while ((de = readdir(proc)) != NULL) {
        if (de->d_name[0] < '1' || de->d_name[0] > '9') continue;
        long pid = strtol(de->d_name, NULL, 10);
        if (pid <= 1 || pid == self) continue;
        snprintf(path, sizeof path, "/proc/%ld/statm", pid);
        int fd = open(path, O_RDONLY | O_CLOEXEC);
        if (fd < 0) continue;
        ssize_t n = read(fd, buf, sizeof buf - 1);
        close(fd);
        if (n <= 0) continue;
        buf[n] = 0;
        char *p = strchr(buf, ' ');
        if (p) total += strtoll(p + 1, NULL, 10) * page_kb;
    }
    return total;
}

/* Inodes in use on the writable tmpfs mounts. */
static long long tmpfs_inodes(void) {
    static const char *const mounts[] = {"/work", "/dev/shm"};
    long long used = 0;
    for (size_t i = 0; i < sizeof mounts / sizeof *mounts; i++) {
        struct statvfs st;
        if (statvfs(mounts[i], &st) == 0 && st.f_files >= st.f_ffree) used += (long long)(st.f_files - st.f_ffree);
    }
    return used;
}

static void set_limit(int res, rlim_t soft, rlim_t hard) {
    struct rlimit rl = {soft, hard};
    setrlimit(res, &rl);
}

static void set_nonblock(int fd) {
    int fl = fcntl(fd, F_GETFL);
    fcntl(fd, F_SETFL, fl | O_NONBLOCK);
}

struct opts {
    int in_fd;
    long wall_ms, cpu_s, stack_mb, fsize_mb, nofile, nproc, max_rss_mb, max_files;
    long long max_output;
    const char *cwd;
    char **argv;
};

static long parse_long(const char *s) {
    char *end;
    errno = 0;
    long v = strtol(s, &end, 10);
    if (errno || *end || end == s) {
        dprintf(2, "ipp-run: bad number '%s'\n", s);
        _exit(125);
    }
    return v;
}

static void parse_opts(int argc, char **argv, struct opts *o) {
    memset(o, 0, sizeof *o);
    o->stack_mb = -1;
    o->fsize_mb = -1;
    o->nofile = -1;
    o->nproc = -1;
    o->max_output = -1;
    int i = 1;
    for (; i < argc; i++) {
        const char *a = argv[i];
        if (!strcmp(a, "--")) { i++; break; }
        if (i + 1 >= argc) { dprintf(2, "ipp-run: missing value for %s\n", a); _exit(125); }
        const char *v = argv[++i];
        if (!strcmp(a, "--in-fd")) o->in_fd = (int)parse_long(v);
        else if (!strcmp(a, "--wall-ms")) o->wall_ms = parse_long(v);
        else if (!strcmp(a, "--cpu-s")) o->cpu_s = parse_long(v);
        else if (!strcmp(a, "--stack-mb")) o->stack_mb = parse_long(v);
        else if (!strcmp(a, "--fsize-mb")) o->fsize_mb = parse_long(v);
        else if (!strcmp(a, "--nofile")) o->nofile = parse_long(v);
        else if (!strcmp(a, "--max-output")) o->max_output = parse_long(v);
        else if (!strcmp(a, "--nproc")) o->nproc = parse_long(v);
        else if (!strcmp(a, "--max-rss-mb")) o->max_rss_mb = parse_long(v);
        else if (!strcmp(a, "--max-files")) o->max_files = parse_long(v);
        else if (!strcmp(a, "--cwd")) o->cwd = v;
        else { dprintf(2, "ipp-run: unknown option %s\n", a); _exit(125); }
    }
    if (i >= argc) { dprintf(2, "ipp-run: no program given\n"); _exit(125); }
    o->argv = argv + i;
}

/* Move fd to a number >= 100 so it cannot collide with the target fds 0..3. */
static int high_fd(int fd) {
    int h = fcntl(fd, F_DUPFD, 100);
    if (h < 0) die("F_DUPFD");
    close(fd);
    return h;
}

/* Runs in the forked child; never returns. Reports exec failures through err_fd. */
static void exec_child(struct opts *o, int in_r, int out_w, int err_w, int exec_err_w) {
    prctl(PR_SET_PDEATHSIG, SIGKILL);
    sigset_t none;
    sigemptyset(&none);
    sigprocmask(SIG_SETMASK, &none, NULL);
    signal(SIGCHLD, SIG_DFL);
    signal(SIGPIPE, SIG_DFL);

    int fd = open("/proc/self/oom_score_adj", O_WRONLY | O_CLOEXEC);
    if (fd >= 0) {
        ssize_t r = write(fd, "1000", 4);
        (void)r;
        close(fd);
    }

    if (in_r >= 0) in_r = high_fd(in_r);
    out_w = high_fd(out_w);
    err_w = high_fd(err_w);
    exec_err_w = high_fd(exec_err_w);
    fcntl(exec_err_w, F_SETFD, FD_CLOEXEC);

    int devnull = open("/dev/null", O_RDWR);
    if (devnull < 0) die("open /dev/null");
    devnull = high_fd(devnull);

    if (o->in_fd == 0 && in_r >= 0) dup2(in_r, 0);
    else dup2(devnull, 0);
    dup2(out_w, 1);
    dup2(err_w, 2);
    if (o->in_fd > 0 && in_r >= 0) dup2(in_r, o->in_fd);
    for (int f = 3; f < 1024; f++) {
        if (f == o->in_fd || f == exec_err_w) continue;
        close(f);
    }

    if (o->cwd && chdir(o->cwd) != 0) {
        int e = errno;
        ssize_t r = write(exec_err_w, &e, sizeof e);
        (void)r;
        _exit(127);
    }
    set_limit(RLIMIT_CORE, 0, 0);
    if (o->cpu_s > 0) set_limit(RLIMIT_CPU, (rlim_t)o->cpu_s, (rlim_t)o->cpu_s + 1);
    if (o->stack_mb >= 0) set_limit(RLIMIT_STACK, (rlim_t)o->stack_mb << 20, (rlim_t)o->stack_mb << 20);
    if (o->fsize_mb >= 0) set_limit(RLIMIT_FSIZE, (rlim_t)o->fsize_mb << 20, (rlim_t)o->fsize_mb << 20);
    if (o->nofile >= 0) set_limit(RLIMIT_NOFILE, (rlim_t)o->nofile, (rlim_t)o->nofile);
    if (o->nproc > 0) set_limit(RLIMIT_NPROC, (rlim_t)o->nproc, (rlim_t)o->nproc);

    execvp(o->argv[0], o->argv);
    int e = errno;
    ssize_t r = write(exec_err_w, &e, sizeof e);
    (void)r;
    _exit(127);
}

int main(int argc, char **argv) {
    if (argc == 2 && !strcmp(argv[1], "--idle")) idle_main();

    struct opts o;
    parse_opts(argc, argv, &o);

    /* Not ptrace-able / readable by the program we are about to start (same uid). */
    prctl(PR_SET_DUMPABLE, 0);
    prctl(PR_SET_CHILD_SUBREAPER, 1);
    signal(SIGPIPE, SIG_IGN);

    /* Leftovers from an earlier run in this container (e.g. after the judge abandoned it). */
    kill_all();

    if (pipe2(sigchld_pipe, O_CLOEXEC | O_NONBLOCK) != 0) die("pipe");
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_sigchld;
    sa.sa_flags = SA_NOCLDSTOP | SA_RESTART;
    sigaction(SIGCHLD, &sa, NULL);

    int in_p[2] = {-1, -1}, out_p[2], err_p[2], exec_p[2];
    if (o.in_fd >= 0 && pipe2(in_p, O_CLOEXEC) != 0) die("pipe");
    if (pipe2(out_p, O_CLOEXEC) != 0 || pipe2(err_p, O_CLOEXEC) != 0 || pipe2(exec_p, O_CLOEXEC) != 0) die("pipe");

    DIR *proc = o.max_rss_mb > 0 ? opendir("/proc") : NULL;
    long page_kb = sysconf(_SC_PAGESIZE) / 1024;
    long long files_cap = o.max_files;
    if (files_cap > 0) {
        long long at_start = tmpfs_inodes();
        if (at_start > files_cap) files_cap = at_start;
    }
    long long peak_rss_kb = 0;
    double next_watch = 0;

    long oom_before = read_oom_kills();
    double t0 = now_ms();
    child = fork();
    if (child < 0) die("fork");
    if (child == 0) exec_child(&o, in_p[0], out_p[1], err_p[1], exec_p[1]);

    if (in_p[0] >= 0) close(in_p[0]);
    close(out_p[1]);
    close(err_p[1]);
    close(exec_p[1]);

    char spawn_error[256] = "";
    {
        int e;
        ssize_t n;
        do n = read(exec_p[0], &e, sizeof e);
        while (n < 0 && errno == EINTR);
        if (n == (ssize_t)sizeof e) snprintf(spawn_error, sizeof spawn_error, "%s: %s", o.argv[0], strerror(e));
        close(exec_p[0]);
    }

    int in_w = in_p[1];
    if (in_w >= 0) set_nonblock(in_w);
    set_nonblock(out_p[0]);
    set_nonblock(err_p[0]);
    set_nonblock(0);

    int out_r = out_p[0], err_r = err_p[0];
    int judge_open = 1;
    int close_in_pending = 0;
    int timed_out = 0, output_limit = 0, killed = 0, memory_limit = 0, file_limit = 0;
    long long relayed = 0;
    double kill_time = -1;

    /* Pending bytes for the program's input. */
    char *inbuf = NULL;
    size_t inbuf_len = 0, inbuf_cap = 0;
    /* Partial frame from the judge. */
    static unsigned char fbuf[BUF_SIZE + 5];
    size_t fbuf_len = 0;
    static char buf[BUF_SIZE];

    for (;;) {
        reap();
        if (child_done && kill_time < 0) {
            /* Program finished: nothing it spawned may outlive it. */
            kill_all();
            kill_time = now_ms();
        }
        if (child_done && out_r < 0 && err_r < 0) break;
        if (kill_time >= 0 && now_ms() - kill_time > 2000) break; /* pipes held by something unkillable */

        double now = now_ms();
        if (!child_done && o.wall_ms > 0 && now - t0 >= (double)o.wall_ms) {
            timed_out = 1;
            kill_all();
            continue;
        }
        int watching = !child_done && (proc || files_cap > 0);
        if (watching && now >= next_watch) {
            next_watch = now + 50;
            if (proc) {
                long long rss = sandbox_rss_kb(proc, page_kb);
                if (rss > peak_rss_kb) peak_rss_kb = rss;
                if (rss * 2 > (long long)o.max_rss_mb * 1024) next_watch = now + 10;
                if (rss > (long long)o.max_rss_mb * 1024) {
                    memory_limit = 1;
                    kill_all();
                    continue;
                }
            }
            if (files_cap > 0 && tmpfs_inodes() > files_cap) {
                file_limit = 1;
                kill_all();
                continue;
            }
        }

        struct pollfd pfds[5];
        int n = 0, i_err = -1, i_out = -1, i_judge = -1, i_in = -1, i_sig;
        if (err_r >= 0) { i_err = n; pfds[n++] = (struct pollfd){err_r, POLLIN, 0}; }
        if (out_r >= 0) { i_out = n; pfds[n++] = (struct pollfd){out_r, POLLIN, 0}; }
        if (judge_open && inbuf_len < (64u << 20)) { i_judge = n; pfds[n++] = (struct pollfd){0, POLLIN, 0}; }
        if (in_w >= 0 && inbuf_len > 0) { i_in = n; pfds[n++] = (struct pollfd){in_w, POLLOUT, 0}; }
        i_sig = n;
        pfds[n++] = (struct pollfd){sigchld_pipe[0], POLLIN, 0};

        int timeout = 1000;
        if (!child_done && o.wall_ms > 0) {
            double left = (double)o.wall_ms - (now - t0);
            timeout = left < 0 ? 0 : (int)left + 1;
            if (timeout > 1000) timeout = 1000;
        }
        if (watching) {
            int left = (int)(next_watch - now) + 1;
            if (left < timeout) timeout = left < 1 ? 1 : left;
        }
        if (kill_time >= 0) timeout = 50;
        int pr = poll(pfds, (nfds_t)n, timeout);
        if (pr < 0) {
            if (errno == EINTR) continue;
            die("poll");
        }

        if (pfds[i_sig].revents) {
            char drain[64];
            while (read(sigchld_pipe[0], drain, sizeof drain) > 0) {}
        }

        /* stderr before stdout: anything written to stderr before a stdout write is relayed first. */
        int idx[2] = {i_err, i_out};
        for (int k = 0; k < 2; k++) {
            int ii = idx[k];
            if (ii < 0 || !pfds[ii].revents) continue;
            int *fdp = k == 0 ? &err_r : &out_r;
            for (;;) {
                ssize_t r = read(*fdp, buf, sizeof buf);
                if (r > 0) {
                    size_t send = (size_t)r;
                    if (o.max_output >= 0 && relayed + r > o.max_output) {
                        send = relayed < o.max_output ? (size_t)(o.max_output - relayed) : 0;
                        if (!output_limit && !child_done) {
                            output_limit = 1;
                            kill_all();
                        }
                    }
                    if (send) send_frame(k == 0 ? 'E' : 'O', buf, (uint32_t)send);
                    relayed += r;
                    if ((size_t)r < sizeof buf) break;
                    continue;
                }
                if (r == 0) { close(*fdp); *fdp = -1; }
                else if (errno == EINTR) continue;
                else if (errno != EAGAIN) { close(*fdp); *fdp = -1; }
                break;
            }
        }

        if (i_judge >= 0 && pfds[i_judge].revents) {
            ssize_t r = read(0, fbuf + fbuf_len, sizeof fbuf - fbuf_len);
            if (r == 0 || (r < 0 && errno != EAGAIN && errno != EINTR)) {
                judge_open = 0;
                if (!child_done) { killed = 1; kill_all(); }
            } else if (r > 0) {
                fbuf_len += (size_t)r;
                size_t off = 0;
                while (fbuf_len - off >= 5) {
                    unsigned char t = fbuf[off];
                    uint32_t len = ((uint32_t)fbuf[off + 1] << 24) | ((uint32_t)fbuf[off + 2] << 16) |
                                   ((uint32_t)fbuf[off + 3] << 8) | fbuf[off + 4];
                    if (len > BUF_SIZE) { dprintf(2, "ipp-run: frame too large\n"); kill_all(); _exit(125); }
                    if (fbuf_len - off - 5 < len) break;
                    const unsigned char *payload = fbuf + off + 5;
                    if (t == 'D' && in_w >= 0) {
                        if (inbuf_len + len > inbuf_cap) {
                            inbuf_cap = (inbuf_len + len) * 2;
                            inbuf = realloc(inbuf, inbuf_cap);
                            if (!inbuf) die("realloc");
                        }
                        memcpy(inbuf + inbuf_len, payload, len);
                        inbuf_len += len;
                    } else if (t == 'C') {
                        close_in_pending = 1;
                    } else if (t == 'K') {
                        if (!child_done) { killed = 1; kill_all(); }
                    }
                    off += 5 + len;
                }
                memmove(fbuf, fbuf + off, fbuf_len - off);
                fbuf_len -= off;
            }
        }

        if (in_w >= 0 && inbuf_len > 0) {
            ssize_t w = write(in_w, inbuf, inbuf_len);
            if (w > 0) {
                memmove(inbuf, inbuf + w, inbuf_len - (size_t)w);
                inbuf_len -= (size_t)w;
            } else if (w < 0 && errno != EAGAIN && errno != EINTR) {
                /* EPIPE: the program closed its input. Drop what is left. */
                inbuf_len = 0;
                close(in_w);
                in_w = -1;
            }
        }
        if (in_w >= 0 && close_in_pending && inbuf_len == 0) {
            close(in_w);
            in_w = -1;
        }
        (void)i_in;
    }

    double wall = now_ms() - t0;
    struct rusage all;
    getrusage(RUSAGE_CHILDREN, &all);
    long oom_after = read_oom_kills();
    int oom = oom_before >= 0 && oom_after > oom_before;

    char exit_s[32] = "null", sig_s[32] = "null";
    if (child_done && WIFEXITED(child_status)) snprintf(exit_s, sizeof exit_s, "%d", WEXITSTATUS(child_status));
    if (child_done && WIFSIGNALED(child_status)) snprintf(sig_s, sizeof sig_s, "%d", WTERMSIG(child_status));
    double cpu = all.ru_utime.tv_sec * 1000.0 + all.ru_utime.tv_usec / 1000.0 + all.ru_stime.tv_sec * 1000.0 +
                 all.ru_stime.tv_usec / 1000.0;
    long maxrss = all.ru_maxrss > child_ru.ru_maxrss ? all.ru_maxrss : child_ru.ru_maxrss;

    char spawn_json[300] = "null";
    if (spawn_error[0]) {
        /* strerror text and the program path contain no characters that need escaping beyond quotes. */
        char *p = spawn_json;
        *p++ = '"';
        for (char *s = spawn_error; *s && p < spawn_json + sizeof spawn_json - 3; s++)
            if (*s != '"' && *s != '\\' && (unsigned char)*s >= 0x20) *p++ = *s;
        *p++ = '"';
        *p = 0;
    }
    char status[1024];
    int len = snprintf(status, sizeof status,
                       "{\"exitCode\":%s,\"signal\":%s,\"wallMs\":%.3f,\"cpuMs\":%.3f,\"maxRssKb\":%ld,"
                       "\"peakRssKb\":%lld,\"oomKilled\":%s,\"memoryLimit\":%s,\"fileLimit\":%s,"
                       "\"timedOut\":%s,\"outputLimit\":%s,\"killed\":%s,\"spawnError\":%s}",
                       exit_s, sig_s, wall, cpu, maxrss, peak_rss_kb, oom ? "true" : "false",
                       memory_limit ? "true" : "false", file_limit ? "true" : "false", timed_out ? "true" : "false",
                       output_limit ? "true" : "false", killed ? "true" : "false", spawn_json);
    send_frame('X', status, (uint32_t)len);
    return 0;
}
