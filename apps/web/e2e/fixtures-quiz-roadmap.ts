/**
 * Roadmap fixtures (GET /api/quiz/roadmap): the real topics and areas from
 * packages/content/quiz/roadmap.yaml with their question counts at the time of writing, and a
 * made-up mix of progress (C++ well under way, computer architecture and concurrency untouched),
 * and a made-up quant topic (probability) to go with fixtures-quiz-quant.ts.
 */
import { QuizRoadmapTopic } from '@ipp/contracts';

type Sub = [subtopic: string, questions: number, open: number];

const n = (id: string, title: string, description: string, requires: string[], subs: Sub[]) => ({
  id,
  title,
  description,
  requires,
  subs,
});

// biome-ignore format: data, one area per line
const CONTENT = [
  {
    slug: "cpp",
    track: "fundamentals",
    title: "C++",
    description: "Language rules, the standard library, object lifetime, templates, and what programs actually print.",
    nodes: [
      n("cpp-initialization", "Initialization", "The many forms of initialization, what each one does, and the defaults you get.", [], [["Initialization", 16, 3]]),
      n("cpp-conversions", "Conversions and const", "Integer promotions, implicit conversions and where const really applies.", [], [["Integer promotions and conversions", 10, 1], ["const-correctness", 9, 2]]),
      n("cpp-object-lifetime", "Object lifetime", "Construction, destruction, RAII and the special member functions.", ["cpp-initialization"], [["Object lifetime and special member functions", 19, 4]]),
      n("cpp-undefined-behaviour", "Undefined behaviour", "What the standard leaves undefined or unspecified, and how it bites.", ["cpp-initialization","cpp-conversions"], [["Undefined and unspecified behaviour", 15, 2]]),
      n("cpp-overloading", "Overloading and lookup", "How a call picks its function, from name lookup to overload ranking.", ["cpp-conversions"], [["Overload resolution and name lookup", 22, 3]]),
      n("cpp-move-semantics", "Move semantics", "Value categories, rvalue references, std::move and what a moved-from object is.", ["cpp-object-lifetime"], [["Value categories and move semantics", 20, 4]]),
      n("cpp-virtual-dispatch", "Virtual dispatch", "Inheritance, vtables, slicing and the object model behind them.", ["cpp-object-lifetime"], [["Virtual dispatch and the object model", 21, 5]]),
      n("cpp-templates", "Templates and constexpr", "Deduction, SFINAE, concepts and evaluating code at compile time.", ["cpp-overloading"], [["Templates, deduction, SFINAE and concepts", 26, 4], ["constexpr and compile-time evaluation", 11, 1]]),
      n("cpp-build-model", "Build model and ODR", "Translation units, linkage, the One Definition Rule and what the linker sees.", ["cpp-overloading"], [["Build model, ODR and linkage", 14, 4]]),
      n("cpp-ownership", "Ownership and exceptions", "Smart pointers, who owns what, and code that stays correct when something throws.", ["cpp-move-semantics"], [["Smart pointers and ownership", 17, 4], ["Exceptions and noexcept", 12, 3]]),
      n("cpp-containers", "Containers and strings", "Standard containers, iterator invalidation, std::string and string_view.", ["cpp-move-semantics","cpp-templates"], [["Containers and iterators", 15, 5], ["Strings and string_view", 9, 1]]),
      n("cpp-lambdas-algorithms", "Lambdas and algorithms", "Closures and captures, the standard algorithms and ranges.", ["cpp-containers"], [["Lambdas and closures", 11, 4], ["Algorithms and ranges", 10, 2]]),
      n("cpp-modern", "Modern C++", "What C++17, C++20 and C++23 added, from optional and variant to coroutines.", ["cpp-containers"], [["C++17, C++20 and C++23 features", 11, 3]]),
      n("cpp-memory-performance", "Memory and performance", "Alignment, allocation and the idioms that make C++ fast.", ["cpp-ownership","cpp-containers"], [["Memory, alignment and allocation", 10, 4], ["Performance idioms", 12, 4]]),
      n("cpp-concurrency", "Concurrency", "Threads, atomics and the C++ memory model.", ["cpp-undefined-behaviour","cpp-lambdas-algorithms"], [["Concurrency and the memory model", 18, 6]]),
    ],
  },
  {
    slug: "python",
    track: "fundamentals",
    title: "Python",
    description: "Language semantics, the data model, the standard library, and common gotchas.",
    nodes: [
      n("py-numbers-strings", "Numbers and strings", "Integers, floats, text and bytes, and the surprises in each.", [], [["Numbers", 6, 1], ["Strings and bytes", 6, 1]]),
      n("py-scope-imports", "Scope and imports", "How names are bound and looked up, and how modules and packages are loaded.", [], [["Names and scope", 12, 1], ["Import system", 7, 3], ["Modules", 1, 0], ["Packages", 1, 0]]),
      n("py-mutability", "Mutability and identity", "Names as references, aliasing, copying, and is versus ==.", [], [["Mutability and aliasing", 11, 1], ["Identity and equality", 4, 0], ["Copying", 3, 1]]),
      n("py-functions", "Functions and closures", "Parameters, default arguments, closures, late binding and decorators.", ["py-scope-imports","py-mutability"], [["Functions", 1, 0], ["Parameters", 3, 0], ["Default arguments", 4, 1], ["Closures and late binding", 5, 1], ["Decorators", 4, 2]]),
      n("py-containers", "Containers and hashing", "Lists, dicts and sets, what makes a key hashable, and what operations cost.", ["py-numbers-strings","py-mutability"], [["Containers", 3, 1], ["Dicts", 4, 1], ["Hashing and ordering", 4, 1], ["Complexity", 1, 0]]),
      n("py-iteration", "Iterators and generators", "The iteration protocol, generators and comprehensions.", ["py-functions","py-containers"], [["Iteration protocol", 1, 0], ["Iterators", 5, 1], ["Generators", 5, 1], ["Comprehensions", 1, 1]]),
      n("py-classes", "Classes", "Class and instance attributes, inheritance and the MRO, ABCs and dataclasses.", ["py-functions"], [["Class and instance attributes", 3, 0], ["MRO and super", 4, 1], ["Abstract base classes", 1, 0], ["Dataclasses", 4, 1]]),
      n("py-exceptions", "Exceptions", "Raising and handling, chaining, exception groups and context managers.", ["py-functions"], [["Exceptions", 7, 2], ["Exception chaining", 1, 0], ["Exception groups", 1, 0], ["Context managers", 3, 1]]),
      n("py-data-model", "Data model", "Special methods, operator dispatch, attribute access and object creation.", ["py-classes"], [["Data model", 8, 2], ["Operator dispatch", 3, 1], ["Attribute access", 2, 1], ["Object creation", 1, 0]]),
      n("py-stdlib", "Standard library", "collections, functools, itertools, heapq, bisect and sorting.", ["py-iteration"], [["collections", 4, 1], ["functools", 2, 0], ["itertools", 1, 0], ["heapq", 2, 1], ["bisect", 1, 0], ["Sorting", 1, 0], ["Performance", 1, 1]]),
      n("py-concurrency", "Concurrency and asyncio", "The GIL, threads, processes, free-threading and asyncio.", ["py-iteration","py-exceptions"], [["GIL", 3, 1], ["Threading", 1, 1], ["Multiprocessing", 1, 0], ["Free-threading", 2, 1], ["Concurrency models", 1, 1], ["asyncio", 6, 1]]),
      n("py-typing", "Type hints", "Annotations, generics and variance, and protocols.", ["py-classes"], [["Type hints", 4, 1], ["Annotations", 2, 1], ["Generics and variance", 3, 1], ["Protocols", 1, 0]]),
      n("py-descriptors", "Descriptors and metaclasses", "Properties, bound methods, __slots__, descriptors and how classes are made.", ["py-data-model"], [["Descriptors", 4, 1], ["Properties", 2, 0], ["Bound methods", 2, 0], ["__slots__", 3, 1], ["Metaclasses", 4, 1], ["Class creation", 1, 0]]),
      n("py-memory", "Memory and GC", "Reference counting, the cycle collector and weak references.", ["py-data-model"], [["Memory management", 5, 2], ["Garbage collection", 2, 1], ["Weak references", 2, 1]]),
    ],
  },
  {
    slug: "computer-architecture",
    track: "fundamentals",
    title: "Computer architecture",
    description: "CPUs, caches, memory hierarchy, pipelines, data representation, and performance.",
    nodes: [
      n("ca-data-representation", "Data representation", "Integers, two's complement, floating point, endianness and layout in memory.", [], [["Data representation", 19, 6]]),
      n("ca-latency-numbers", "Latency numbers", "The orders of magnitude every engineer should know, from a register to a disk.", [], [["Numbers every engineer should know", 8, 3]]),
      n("ca-instruction-sets", "Instruction sets", "What an ISA defines, and how calling conventions pass arguments and results.", ["ca-data-representation"], [["Instruction sets and calling conventions", 14, 6]]),
      n("ca-memory-hierarchy", "Memory hierarchy", "Registers to DRAM, virtual memory and TLBs, and memory bandwidth.", ["ca-latency-numbers"], [["Memory hierarchy and TLBs", 11, 5], ["DRAM and bandwidth", 3, 0]]),
      n("ca-pipelines", "Pipelines and branches", "Pipelining, hazards and how branch prediction keeps the pipeline full.", ["ca-instruction-sets"], [["Pipelining and hazards", 6, 1], ["Branch prediction", 9, 4]]),
      n("ca-simd", "SIMD", "Vector instructions, and writing code the compiler can vectorise.", ["ca-instruction-sets"], [["SIMD", 9, 4]]),
      n("ca-caches", "Caches", "Lines, associativity, replacement, write policies and access patterns.", ["ca-memory-hierarchy"], [["Caches", 25, 9]]),
      n("ca-storage", "Storage and I/O", "SSDs, disks, DMA and the cost of getting data in and out.", ["ca-memory-hierarchy"], [["Storage and I/O", 10, 4]]),
      n("ca-out-of-order", "Out-of-order execution", "Instruction-level parallelism, reordering and speculative execution.", ["ca-pipelines"], [["Out-of-order and speculative execution", 8, 2], ["Instruction-level parallelism", 7, 2]]),
      n("ca-multicore", "Multicore, SMT and NUMA", "Many cores, hardware threads, and memory that is nearer to some cores.", ["ca-caches"], [["Multicore and SMT", 4, 2], ["NUMA", 3, 1]]),
      n("ca-coherence", "Coherence and ordering", "Keeping caches coherent, and the memory orderings hardware provides.", ["ca-multicore"], [["Cache coherence and memory ordering", 16, 7]]),
      n("ca-performance", "Performance analysis", "Measuring, profiling and reasoning about where the time goes.", ["ca-out-of-order","ca-caches"], [["Performance analysis", 19, 9]]),
    ],
  },
  {
    slug: "operating-systems",
    track: "fundamentals",
    title: "Operating systems",
    description: "Processes, threads, scheduling, virtual memory, file systems, and system calls.",
    nodes: [
      n("os-kernel", "Kernel and system calls", "User and kernel mode, system calls, interrupts and how a machine boots.", [], [["System calls", 8, 4], ["Interrupts and exceptions", 4, 1], ["Booting", 3, 1], ["I/O devices and drivers", 1, 1]]),
      n("os-processes", "Processes and threads", "What a process and a thread are, and a process's life from start to exit.", ["os-kernel"], [["Processes and threads", 5, 2], ["Process lifecycle", 7, 4]]),
      n("os-virtual-memory", "Virtual memory", "Address spaces, paging, page faults, mmap, overcommit and the OOM killer.", ["os-kernel"], [["Virtual memory", 25, 9], ["Overcommit and OOM", 3, 1]]),
      n("os-process-control", "fork, exec and signals", "Creating processes with copy-on-write, replacing their image, and signals.", ["os-processes","os-virtual-memory"], [["fork and exec", 9, 2], ["Signals", 6, 3], ["Signals and system calls", 2, 1]]),
      n("os-files", "File descriptors and I/O", "A process's descriptors, reads and writes, buffering and non-blocking I/O.", ["os-processes"], [["File descriptors and I/O", 15, 5]]),
      n("os-scheduling", "Scheduling", "How the scheduler shares the CPUs, real-time policies and tuning for latency.", ["os-processes"], [["Scheduling", 7, 3], ["Real-time scheduling", 4, 1], ["Low-latency tuning", 2, 1]]),
      n("os-allocators", "Memory allocators", "malloc and free, fragmentation, and allocators built on the virtual memory system.", ["os-virtual-memory"], [["Memory allocators", 8, 3]]),
      n("os-ipc", "IPC and kernel locks", "Pipes, shared memory and sockets between processes, and locking in the kernel.", ["os-process-control","os-files"], [["IPC", 7, 2], ["Kernel synchronization and deadlock", 6, 2]]),
      n("os-file-systems", "File systems", "Inodes, directories, links, the page cache and keeping data durable.", ["os-files"], [["File systems", 14, 4]]),
      n("os-linking", "Linking and loading", "Static and dynamic linking, and how exec turns a file into a running program.", ["os-process-control"], [["Linking and loading", 9, 4]]),
      n("os-containers", "Containers and VMs", "Namespaces, cgroups and what separates a container from a virtual machine.", ["os-file-systems"], [["Containers and virtualization", 10, 3]]),
      n("os-practical-linux", "Practical Linux", "Finding out what a live system is doing, with the tools at hand.", ["os-ipc"], [["Practical Linux", 9, 5]]),
    ],
  },
  {
    slug: "concurrency",
    track: "fundamentals",
    title: "Concurrency",
    description: "Threads, locks, atomics, memory models, lock-free structures, and classic bugs.",
    nodes: [
      n("cc-threads", "Threads and processes", "Concurrency versus parallelism, a thread's life, and what limits scaling.", [], [["Threads and processes", 5, 2], ["Concurrency vs parallelism", 1, 0], ["Thread lifecycle", 4, 1], ["Thread-local storage", 1, 0]]),
      n("cc-races", "Races and thread safety", "Data races and race conditions, critical sections and what thread-safe means.", ["cc-threads"], [["Data races", 6, 1], ["Races", 2, 2], ["Critical sections", 1, 1], ["Thread safety", 4, 4], ["Signals and reentrancy", 1, 1], ["Testing concurrent code", 1, 1]]),
      n("cc-mutexes", "Mutexes and locks", "Mutexes, spinlocks, reader-writer locks, one-time initialisation and priority inversion.", ["cc-races"], [["Mutexes", 7, 3], ["Spinlocks", 4, 3], ["Reader-writer locks", 2, 0], ["One-time initialisation", 3, 0], ["Priority inversion", 2, 1]]),
      n("cc-atomics", "Atomics and CAS", "Atomic operations, compare-and-swap, and why volatile is not one of them.", ["cc-races"], [["Atomics", 7, 2], ["Compare-and-swap", 2, 1], ["volatile", 1, 0]]),
      n("cc-python", "Python threads and the GIL", "What the GIL does and does not protect, threads and processes in Python.", ["cc-races"], [["Python GIL", 5, 1], ["Python threading", 6, 0], ["Python concurrency models", 1, 1], ["Processes", 2, 0]]),
      n("cc-deadlock", "Deadlock and liveness", "The conditions for deadlock, avoiding it, and livelock and starvation.", ["cc-mutexes"], [["Deadlock", 9, 4], ["Livelock and starvation", 3, 1]]),
      n("cc-condition-variables", "Condition variables", "Waiting for a condition, monitors, semaphores, latches and barriers.", ["cc-mutexes"], [["Condition variables", 8, 4], ["Monitors", 1, 0], ["Semaphores", 4, 1], ["Latches and barriers", 2, 1]]),
      n("cc-memory-ordering", "Memory ordering", "Happens-before, acquire and release, fences and hardware memory models.", ["cc-atomics"], [["Memory ordering", 10, 5], ["Happens-before", 1, 0], ["Fences", 1, 0], ["Hardware memory models", 2, 0], ["Java memory model", 2, 0]]),
      n("cc-classic-problems", "Classic problems", "Producer-consumer, readers-writers and the dining philosophers.", ["cc-condition-variables","cc-deadlock"], [["Producer-consumer", 3, 3], ["Readers-writers", 2, 1], ["Dining philosophers", 2, 1]]),
      n("cc-pools-futures", "Pools and futures", "Thread pools, work stealing, futures and promises.", ["cc-condition-variables"], [["Thread pools", 4, 2], ["Work stealing", 1, 1], ["Futures and async", 9, 3]]),
      n("cc-lock-free", "Lock-free structures", "Progress guarantees, ring buffers, ABA, memory reclamation, RCU and seqlocks.", ["cc-memory-ordering"], [["Lock-free structures", 2, 1], ["Progress guarantees", 3, 0], ["Ring buffers", 3, 1], ["ABA problem", 1, 1], ["Memory reclamation", 1, 1], ["RCU", 1, 0], ["Seqlocks", 1, 1], ["Correctness criteria", 1, 1], ["Lock-free performance", 1, 0]]),
      n("cc-scaling", "Scaling and contention", "Amdahl's law, contended locks and atomics, false sharing and cache coherence.", ["cc-mutexes","cc-atomics"], [["Scaling", 2, 1], ["Contention", 3, 1], ["False sharing", 3, 1], ["Cache coherence", 1, 0]]),
      n("cc-event-loops", "Event loops and coroutines", "Event loops, green threads and coroutines, and when they beat threads.", ["cc-pools-futures"], [["Event loops", 5, 3], ["Coroutines", 3, 1]]),
      n("cc-asyncio", "asyncio", "Tasks, cancellation and the traps of Python's event loop.", ["cc-event-loops"], [["asyncio", 12, 1]]),
    ],
  },
  {
    slug: "networking",
    track: "fundamentals",
    title: "Networking",
    description: "TCP/IP, UDP, DNS, HTTP, TLS, sockets, and how packets get from A to B.",
    nodes: [
      n("net-link-layer", "Layers and Ethernet", "The layered model, Ethernet frames, switching, ARP and VLANs.", [], [["Layered model", 1, 1], ["Ethernet and switching", 9, 4], ["ARP", 2, 1], ["VLANs", 1, 0]]),
      n("net-ip", "IP and subnetting", "IPv4 and IPv6 addresses, prefixes and subnet arithmetic.", ["net-link-layer"], [["IP addressing", 5, 3], ["Subnetting", 8, 0], ["IPv6", 3, 1]]),
      n("net-routing", "Routing and NAT", "How routers forward packets, ICMP and path MTU discovery, and NAT.", ["net-ip"], [["Routing", 5, 2], ["NAT", 2, 1], ["ICMP and PMTUD", 3, 1]]),
      n("net-transport", "TCP and UDP", "UDP, and a TCP connection from handshake to close.", ["net-ip"], [["UDP", 5, 2], ["TCP vs UDP", 1, 1], ["TCP connection lifecycle", 14, 6], ["TCP keepalive", 1, 1]]),
      n("net-tcp-performance", "TCP performance", "Flow and congestion control, retransmission, Nagle and head-of-line blocking.", ["net-transport"], [["TCP flow and congestion control", 15, 6], ["TCP retransmission", 4, 1], ["Nagle and delayed ACK", 3, 2], ["Head-of-line blocking", 2, 1]]),
      n("net-dns", "DNS", "Resolution, record types, caching and TTLs.", ["net-transport"], [["DNS", 11, 3]]),
      n("net-tls", "TLS", "Handshakes, certificates and what TLS does and does not protect.", ["net-transport"], [["TLS", 10, 4]]),
      n("net-sockets", "Sockets API", "The sockets API and its options, and multiplexing many connections.", ["net-tcp-performance"], [["Sockets API and options", 20, 4], ["I/O multiplexing", 3, 2]]),
      n("net-http", "HTTP", "Methods, status codes, caching, HTTP/1.1 connections and WebSockets.", ["net-dns","net-tls"], [["HTTP semantics", 8, 1], ["HTTP/1.1", 3, 1], ["WebSockets", 3, 1]]),
      n("net-http2-quic", "HTTP/2 and QUIC", "Multiplexed streams, and HTTP/3 over QUIC.", ["net-http"], [["HTTP/2", 2, 1], ["HTTP/3 and QUIC", 4, 2]]),
      n("net-load-balancing", "Load balancers and CDNs", "Layer 4 and layer 7 load balancing, proxies and content delivery networks.", ["net-http"], [["Load balancing and proxies", 8, 3], ["CDNs", 2, 1]]),
      n("net-low-latency", "Multicast and low latency", "Multicast, market data feeds and kernel bypass.", ["net-sockets"], [["Multicast", 7, 2], ["Market data", 2, 2], ["Kernel bypass and low latency", 8, 3]]),
      n("net-debugging", "Debugging end to end", "What happens when you type a URL, and the tools that show each step.", ["net-http","net-sockets"], [["Debugging tools", 8, 3], ["What happens when you type a URL", 2, 1]]),
    ],
  },
  // The quant track: made up to match fixtures-quiz-quant.ts, not content from roadmap.yaml.
  {
    slug: "probability",
    track: "quant",
    title: "Probability",
    description: "Counting, conditioning, expectation and the classic puzzles.",
    nodes: [
      n("prob-counting", "Counting and dice", "Equally likely outcomes, and counting them without listing them.", [], [["Dice and counting", 1, 0]]),
      n("prob-expectation", "Expectation", "Linearity, indicators and waiting times.", ["prob-counting"], [["Expectation", 1, 0]]),
      n("prob-distributions", "Distributions", "Binomial, geometric and uniform, and what their moments are.", ["prob-counting"], [["Distributions", 2, 0]]),
      n("prob-puzzles", "Classic puzzles", "Hats, boys and girls: the questions every desk asks.", ["prob-expectation"], [["Classic puzzles", 2, 1]]),
    ],
  },
];

/** The `related` links of roadmap.yaml (each written on one side, as there). */
const RELATED: Record<string, string[]> = {
  'cpp-build-model': ['os-linking'],
  'cpp-memory-performance': ['ca-caches', 'os-allocators'],
  'cpp-concurrency': ['cc-races', 'cc-atomics', 'cc-memory-ordering'],
  'py-concurrency': ['cc-python', 'cc-asyncio'],
  'os-virtual-memory': ['ca-memory-hierarchy'],
  'cc-threads': ['os-processes'],
  'cc-memory-ordering': ['ca-coherence'],
  'cc-scaling': ['ca-caches', 'ca-coherence'],
  'cc-event-loops': ['net-sockets'],
  'net-sockets': ['os-files'],
};

/** answered and correct as fractions of the node's questions. */
const PROGRESS: Record<string, [answered: number, correct: number]> = {
  'cpp-initialization': [1, 0.88],
  'cpp-conversions': [1, 0.8],
  'cpp-object-lifetime': [1, 0.74],
  'cpp-undefined-behaviour': [1, 0.53],
  'cpp-overloading': [0.55, 0.36],
  'cpp-move-semantics': [0.3, 0.25],
  'py-mutability': [1, 0.89],
  'py-scope-imports': [0.38, 0.29],
  'py-numbers-strings': [0.25, 0.25],
  'py-functions': [0.12, 0.06],
  'os-kernel': [1, 0.82],
  'os-processes': [0.42, 0.33],
  'os-virtual-memory': [0.14, 0.07],
  'net-link-layer': [0.46, 0.3],
};

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

function build(progress: Record<string, [number, number]>) {
  return QuizRoadmapTopic.array().parse(
    CONTENT.map((t) => {
      const nodes = t.nodes.map((node) => {
        const total = sum(node.subs, (s) => s[1]);
        const [a, c] = progress[node.id] ?? [0, 0];
        let answered = Math.round(total * a);
        let correct = Math.min(answered, Math.round(total * c));
        // Fill the subtopics in order: the first ones are answered first.
        const subtopics = node.subs.map(([subtopic, questionCount, shortCount]) => {
          const ans = Math.min(questionCount, answered);
          const cor = Math.min(ans, correct);
          answered -= ans;
          correct -= cor;
          return {
            subtopic,
            questionCount,
            shortCount,
            answered: ans,
            correct: cor,
            accuracy: ans ? cor / ans : null,
          };
        });
        const nodeAnswered = sum(subtopics, (s) => s.answered);
        const nodeCorrect = sum(subtopics, (s) => s.correct);
        return {
          id: node.id,
          title: node.title,
          description: node.description,
          requires: node.requires,
          related: RELATED[node.id] ?? [],
          subtopics,
          questionCount: total,
          shortCount: sum(subtopics, (s) => s.shortCount),
          answered: nodeAnswered,
          correct: nodeCorrect,
          accuracy: nodeAnswered ? nodeCorrect / nodeAnswered : null,
        };
      });
      const answered = sum(nodes, (x) => x.answered);
      const correct = sum(nodes, (x) => x.correct);
      return {
        slug: t.slug,
        title: t.title,
        track: t.track,
        description: t.description,
        questionCount: sum(nodes, (x) => x.questionCount),
        shortCount: sum(nodes, (x) => x.shortCount),
        answered,
        correct,
        accuracy: answered ? correct / answered : null,
        nodes,
      };
    }),
  );
}

/** Progress as described above. */
export const QUIZ_ROADMAP = build(PROGRESS);
/** A first visit: nothing answered anywhere. */
export const QUIZ_ROADMAP_FRESH = build({});
/** The roadmap before any quant content: one track, so no track headings. */
export const QUIZ_ROADMAP_FUNDAMENTALS = QUIZ_ROADMAP.filter((t) => t.track === 'fundamentals');
