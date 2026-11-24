// interview++ judge: non-template part of the C++ driver (see support.h). Built into
// /opt/ipp/lib/libippdriver.a with exactly the flags jobs are compiled with.
#include "support.h"

#include <cxxabi.h>
#include <sys/resource.h>
#include <unistd.h>

namespace __ipp {

const Json* Json::get(const std::string& k) const {
    for (auto& kv : obj)
        if (kv.first == k) return &kv.second;
    return nullptr;
}

namespace {

class Parser {
    const std::string& s;
    size_t i = 0;
    void ws() {
        while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) ++i;
    }
    [[noreturn]] void fail() { throw BadInput("malformed JSON from the judge"); }
    static void put_utf8(std::string& out, unsigned cp) {
        if (cp < 0x80) out += char(cp);
        else if (cp < 0x800) { out += char(0xC0 | (cp >> 6)); out += char(0x80 | (cp & 0x3F)); }
        else if (cp < 0x10000) {
            out += char(0xE0 | (cp >> 12)); out += char(0x80 | ((cp >> 6) & 0x3F)); out += char(0x80 | (cp & 0x3F));
        } else {
            out += char(0xF0 | (cp >> 18)); out += char(0x80 | ((cp >> 12) & 0x3F));
            out += char(0x80 | ((cp >> 6) & 0x3F)); out += char(0x80 | (cp & 0x3F));
        }
    }
    unsigned hex4() {
        if (i + 4 > s.size()) fail();
        unsigned v = 0;
        for (int k = 0; k < 4; ++k) {
            char c = s[i++];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= unsigned(c - '0');
            else if (c >= 'a' && c <= 'f') v |= unsigned(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') v |= unsigned(c - 'A' + 10);
            else fail();
        }
        return v;
    }
    std::string string_lit() {
        if (i >= s.size() || s[i] != '"') fail();
        ++i;
        std::string out;
        while (true) {
            if (i >= s.size()) fail();
            char c = s[i++];
            if (c == '"') break;
            if (c != '\\') { out += c; continue; }
            if (i >= s.size()) fail();
            char e = s[i++];
            switch (e) {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case 'u': {
                    unsigned cp = hex4();
                    if (cp >= 0xD800 && cp < 0xDC00 && i + 6 <= s.size() && s[i] == '\\' && s[i + 1] == 'u') {
                        size_t save = i;
                        i += 2;
                        unsigned lo = hex4();
                        if (lo >= 0xDC00 && lo < 0xE000) cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        else i = save;
                    }
                    put_utf8(out, cp);
                    break;
                }
                default: fail();
            }
        }
        return out;
    }

public:
    explicit Parser(const std::string& src) : s(src) {}
    Json value(int depth = 0) {
        if (depth > 512) fail();
        ws();
        if (i >= s.size()) fail();
        Json j;
        char c = s[i];
        if (c == '{') {
            j.kind = Json::Obj;
            ++i;
            ws();
            if (i < s.size() && s[i] == '}') { ++i; return j; }
            while (true) {
                ws();
                std::string k = string_lit();
                ws();
                if (i >= s.size() || s[i] != ':') fail();
                ++i;
                j.obj.emplace_back(std::move(k), value(depth + 1));
                ws();
                if (i < s.size() && s[i] == ',') { ++i; continue; }
                if (i < s.size() && s[i] == '}') { ++i; break; }
                fail();
            }
        } else if (c == '[') {
            j.kind = Json::Arr;
            ++i;
            ws();
            if (i < s.size() && s[i] == ']') { ++i; return j; }
            while (true) {
                j.arr.push_back(value(depth + 1));
                ws();
                if (i < s.size() && s[i] == ',') { ++i; continue; }
                if (i < s.size() && s[i] == ']') { ++i; break; }
                fail();
            }
        } else if (c == '"') {
            j.kind = Json::Str;
            j.str = string_lit();
        } else if (s.compare(i, 4, "true") == 0) { j.kind = Json::Bool; j.b = true; i += 4; }
        else if (s.compare(i, 5, "false") == 0) { j.kind = Json::Bool; i += 5; }
        else if (s.compare(i, 4, "null") == 0) { i += 4; }
        else {
            size_t st = i;
            bool integral = true;
            if (s[i] == '-') ++i;
            while (i < s.size() && (isdigit((unsigned char)s[i]) || s[i] == '.' || s[i] == 'e' || s[i] == 'E' ||
                                    s[i] == '+' || s[i] == '-')) {
                if (!isdigit((unsigned char)s[i])) integral = false;
                ++i;
            }
            if (st == i) fail();
            std::string t = s.substr(st, i - st);
            j.kind = Json::Num;
            j.num = std::strtod(t.c_str(), nullptr);
            if (integral) {
                errno = 0;
                long long v = std::strtoll(t.c_str(), nullptr, 10);
                if (errno == 0) { j.is_int = true; j.ival = v; }
            } else if (std::isfinite(j.num) && j.num == std::floor(j.num) && std::fabs(j.num) < 9.2e18) {
                j.is_int = true;
                j.ival = (long long)j.num;
            }
        }
        return j;
    }
};

class Channel {
    int fd;
    std::string buf;
    bool eof = false;

public:
    explicit Channel(int f) : fd(f) {}
    bool line(std::string& out) {
        while (true) {
            size_t nl = buf.find('\n');
            if (nl != std::string::npos) {
                out = buf.substr(0, nl);
                buf.erase(0, nl + 1);
                return true;
            }
            if (eof) return false;
            char tmp[65536];
            ssize_t n = ::read(fd, tmp, sizeof tmp);
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) eof = true;
            else buf.append(tmp, size_t(n));
        }
    }
};

std::string g_marker;

void emit(const std::string& json) {
    std::cout.flush();
    std::cerr.flush();
    std::fflush(stdout);
    std::fflush(stderr);
    std::string frame = g_marker + json + "\n";
    const char* p = frame.data();
    size_t n = frame.size();
    while (n > 0) {
        ssize_t w = ::write(1, p, n);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) std::_Exit(3);
        p += w;
        n -= size_t(w);
    }
}

long rss_kb() {
    struct rusage ru {};
    getrusage(RUSAGE_SELF, &ru);
    return ru.ru_maxrss;
}

std::string num(double v) {
    char b[40];
    std::snprintf(b, sizeof b, "%.4f", v);
    return b;
}

std::string demangle(const char* name) {
    int st = 0;
    char* d = abi::__cxa_demangle(name, nullptr, nullptr, &st);
    std::string r = st == 0 && d ? d : name;
    std::free(d);
    return r;
}

std::string failure(const char* kind, const std::string& error, double ms) {
    std::string msg;
    write_string(msg, error);
    return std::string("{\"t\":\"result\",\"ok\":false,\"kind\":\"") + kind + "\",\"error\":" + msg + ",\"ms\":" + num(ms) +
           ",\"rssKb\":" + std::to_string(rss_kb()) + "}";
}

}  // namespace

Json parse(const std::string& s) { return Parser(s).value(); }

void write_double(std::string& out, double v) {
    if (!std::isfinite(v)) { out += "null"; return; }
    char b[40];
    std::snprintf(b, sizeof b, "%.17g", v);
    out += b;
}

void write_string(std::string& out, std::string_view v) {
    out += '"';
    size_t i = 0;
    while (i < v.size()) {
        unsigned char c = (unsigned char)v[i];
        if (c == '"') { out += "\\\""; ++i; }
        else if (c == '\\') { out += "\\\\"; ++i; }
        else if (c == '\n') { out += "\\n"; ++i; }
        else if (c == '\r') { out += "\\r"; ++i; }
        else if (c == '\t') { out += "\\t"; ++i; }
        else if (c < 0x20 || c == 0x7f) {
            char b[8];
            std::snprintf(b, sizeof b, "\\u%04x", c);
            out += b;
            ++i;
        } else if (c < 0x80) { out += char(c); ++i; }
        else {
            // Copy a valid UTF-8 sequence; replace anything else with U+FFFD.
            size_t n = c >= 0xF0 && c < 0xF5 ? 4 : c >= 0xE0 && c < 0xF0 ? 3 : c >= 0xC2 && c < 0xE0 ? 2 : 0;
            bool ok = n > 0 && i + n <= v.size();
            for (size_t k = 1; ok && k < n; ++k) ok = ((unsigned char)v[i + k] & 0xC0) == 0x80;
            if (ok && n == 3) {
                unsigned cp = ((c & 0x0F) << 12) | (((unsigned char)v[i + 1] & 0x3F) << 6);
                ok = cp >= 0x800 && (cp < 0xD800 || cp >= 0xE000);
            }
            if (ok && n == 4) {
                unsigned cp = ((c & 0x07) << 18) | (((unsigned char)v[i + 1] & 0x3F) << 12);
                ok = cp >= 0x10000 && cp < 0x110000;
            }
            if (ok) { out.append(v.substr(i, n)); i += n; }
            else { out += "\xEF\xBF\xBD"; ++i; }
        }
    }
    out += '"';
}

int run_loop(const Erased& cls) {
    Channel in(3);
    std::string line;
    if (!in.line(line)) return 2;
    Json hdr = parse(line);
    const Json* nonce = hdr.get("nonce");
    if (!nonce || nonce->kind != Json::Str) return 2;
    g_marker = "\x1eIPP" + nonce->str + "\x1f";
    emit("{\"t\":\"ready\"}");

    while (in.line(line)) {
        if (line.empty()) continue;
        double ms = 0;
        std::string out;
        void* obj = nullptr;
        try {
            Json test = parse(line);
            const Json* ctor = test.get("ctorArgs");
            const Json* calls = test.get("calls");
            if (!ctor || !calls || ctor->kind != Json::Arr || calls->kind != Json::Arr)
                throw BadInput("malformed test from the judge");
            obj = cls.make(ctor->arr, ms);
            std::string values = "[";
            for (size_t k = 0; k < calls->arr.size(); ++k) {
                const Json& call = calls->arr[k];
                const Json* m = call.get("method");
                const Json* a = call.get("args");
                if (!m || !a || m->kind != Json::Str || a->kind != Json::Arr) throw BadInput("malformed call");
                CallOut r;
                try {
                    r = cls.call(obj, m->str, a->arr);
                } catch (const BadInput& e) {
                    throw BadInput("call " + std::to_string(k + 1) + " (" + m->str + "): " + e.what());
                }
                ms += r.ms;
                if (k) values += ',';
                values += r.json;
            }
            values += ']';
            out = "{\"t\":\"result\",\"ok\":true,\"values\":" + values + ",\"ms\":" + num(ms) +
                  ",\"rssKb\":" + std::to_string(rss_kb()) + "}";
        } catch (const std::bad_alloc&) {
            out = failure("memory", "std::bad_alloc", ms);
        } catch (const BadInput& e) {
            out = failure("input", e.what(), ms);
        } catch (const std::exception& e) {
            out = failure("exception", demangle(typeid(e).name()) + ": " + e.what(), ms);
        } catch (...) {
            auto* t = abi::__cxa_current_exception_type();
            out = failure("exception", t ? "exception of type " + demangle(t->name()) : "unknown exception", ms);
        }
        if (obj) {
            try {
                cls.destroy(obj);
            } catch (...) {
            }
        }
        emit(out);
    }
    std::cout.flush();
    std::fflush(stdout);
    return 0;
}

}  // namespace __ipp
