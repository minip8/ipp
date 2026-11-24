// interview++ judge: Java driver (compiled into the sandbox image, on the classpath before /work/classes).
// Reads tests one per line from fd 3, calls the candidate's class by reflection and reports results as
// nonce-framed JSON on stdout. Protocol: see apps/judge/README.md. Extra frame for Java:
//   {"t":"init_error","error":"..."}   the class could not be loaded or initialised
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class IppDriver {
    private static OutputStream rawOut;
    private static byte[] marker;

    public static void main(String[] args) throws Exception {
        rawOut = new FileOutputStream(FileDescriptor.out);
        long stack = 256L << 20;
        if (args.length > 0) stack = Long.parseLong(args[0]) << 20;
        Thread t = new Thread(null, () -> {
            try {
                run();
            } catch (Throwable e) {
                e.printStackTrace();
                System.exit(2);
            }
        }, "main", stack);
        t.start();
        t.join();
        System.out.flush();
        System.exit(0);
    }

    private static void emit(String json) throws IOException {
        System.out.flush();
        System.err.flush();
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        byte[] frame = new byte[marker.length + body.length + 1];
        System.arraycopy(marker, 0, frame, 0, marker.length);
        System.arraycopy(body, 0, frame, marker.length, body.length);
        frame[frame.length - 1] = '\n';
        rawOut.write(frame);
        rawOut.flush();
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') return b.toString(StandardCharsets.UTF_8);
            b.write(c);
        }
        return b.size() == 0 ? null : b.toString(StandardCharsets.UTF_8);
    }

    private static void run() throws Exception {
        InputStream chan = new BufferedInputStream(new FileInputStream("/proc/self/fd/3"), 1 << 16);
        Map<String, Object> header = Json.obj(Json.parse(readLine(chan)));
        marker = ("\u001eIPP" + header.get("nonce") + "\u001f").getBytes(StandardCharsets.UTF_8);
        String className = (String) header.get("className");

        Class<?> cls;
        try {
            cls = Class.forName(className, true, IppDriver.class.getClassLoader());
        } catch (ClassNotFoundException e) {
            emit("{\"t\":\"init_error\",\"error\":" + Json.str("class " + className + " not found") + "}");
            return;
        } catch (Throwable e) {
            Throwable c = e instanceof ExceptionInInitializerError && e.getCause() != null ? e.getCause() : e;
            emit("{\"t\":\"init_error\",\"error\":" + Json.str(describe(c)) + "}");
            return;
        }
        emit("{\"t\":\"ready\"}");

        String line;
        while ((line = readLine(chan)) != null) {
            if (line.isBlank()) continue;
            long nanos = 0;
            String frame;
            try {
                Map<String, Object> test = Json.obj(Json.parse(line));
                List<Object> ctorArgs = Json.arr(test.get("ctorArgs"));
                Constructor<?> ctor = findCtor(cls, ctorArgs.size());
                Object[] cargs = convertAll(ctor.getGenericParameterTypes(), ctorArgs);
                long t0 = System.nanoTime();
                Object obj;
                try {
                    obj = ctor.newInstance(cargs);
                } finally {
                    nanos += System.nanoTime() - t0;
                }
                StringBuilder values = new StringBuilder("[");
                List<Object> calls = Json.arr(test.get("calls"));
                for (int k = 0; k < calls.size(); k++) {
                    Map<String, Object> call = Json.obj(calls.get(k));
                    String name = (String) call.get("method");
                    List<Object> a = Json.arr(call.get("args"));
                    Method m = findMethod(cls, name, a.size());
                    Object[] margs;
                    try {
                        margs = convertAll(m.getGenericParameterTypes(), a);
                    } catch (BadInput e) {
                        throw new BadInput("call " + (k + 1) + " (" + name + "): " + e.getMessage());
                    }
                    long t1 = System.nanoTime();
                    Object r;
                    try {
                        r = m.invoke(Modifier.isStatic(m.getModifiers()) ? null : obj, margs);
                    } finally {
                        nanos += System.nanoTime() - t1;
                    }
                    if (k > 0) values.append(',');
                    if (m.getReturnType() == void.class) values.append("null");
                    else Json.write(values, r);
                }
                values.append(']');
                frame = "{\"t\":\"result\",\"ok\":true,\"values\":" + values + ",\"ms\":" + (nanos / 1e6) + "}";
            } catch (Throwable e) {
                Throwable c = e;
                while ((c instanceof InvocationTargetException || c instanceof ExceptionInInitializerError)
                        && c.getCause() != null) c = c.getCause();
                String kind = c instanceof OutOfMemoryError ? "memory" : c instanceof BadInput ? "input" : "exception";
                frame = "{\"t\":\"result\",\"ok\":false,\"kind\":\"" + kind + "\",\"error\":" + Json.str(describe(c))
                        + ",\"ms\":" + (nanos / 1e6) + "}";
            }
            emit(frame);
        }
    }

    /** Exception text plus the candidate's own stack frames (never the driver's). */
    private static String describe(Throwable e) {
        if (e instanceof BadInput) return e.getMessage();
        StringBuilder sb = new StringBuilder(e.toString());
        for (StackTraceElement el : e.getStackTrace()) {
            String f = el.getFileName();
            if (f != null && f.equals("Main.java")) sb.append("\n    at ").append(el);
        }
        return sb.toString();
    }

    static final class BadInput extends RuntimeException {
        BadInput(String m) {
            super(m);
        }
    }

    private static Constructor<?> findCtor(Class<?> cls, int arity) {
        for (Constructor<?> c : cls.getDeclaredConstructors()) {
            if (c.getParameterCount() == arity) {
                c.setAccessible(true);
                return c;
            }
        }
        throw new BadInput("class " + cls.getSimpleName() + " has no constructor taking " + arity + " argument(s)");
    }

    private static Method findMethod(Class<?> cls, String name, int arity) {
        for (Class<?> c = cls; c != null; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) {
                if (m.getName().equals(name) && m.getParameterCount() == arity && !m.isSynthetic()) {
                    m.setAccessible(true);
                    return m;
                }
            }
        }
        throw new BadInput("no method " + name + " taking " + arity + " argument(s)");
    }

    private static Object[] convertAll(Type[] types, List<Object> args) {
        if (types.length != args.size())
            throw new BadInput("expected " + types.length + " arguments, got " + args.size());
        Object[] out = new Object[types.length];
        for (int i = 0; i < types.length; i++) out[i] = convert(types[i], args.get(i));
        return out;
    }

    private static Object convert(Type t, Object v) {
        if (t instanceof Class<?> c) {
            if (c.isArray()) {
                if (!(v instanceof List<?> l)) throw new BadInput("expected an array argument");
                Object arr = Array.newInstance(c.getComponentType(), l.size());
                for (int i = 0; i < l.size(); i++) Array.set(arr, i, convert(c.getComponentType(), l.get(i)));
                return arr;
            }
            if (c == int.class || c == Integer.class) return (int) integral(v);
            if (c == long.class || c == Long.class) return integral(v);
            if (c == short.class || c == Short.class) return (short) integral(v);
            if (c == byte.class || c == Byte.class) return (byte) integral(v);
            if (c == double.class || c == Double.class) return number(v).doubleValue();
            if (c == float.class || c == Float.class) return number(v).floatValue();
            if (c == boolean.class || c == Boolean.class) {
                if (!(v instanceof Boolean b)) throw new BadInput("expected a boolean argument");
                return b;
            }
            if (c == char.class || c == Character.class) {
                if (!(v instanceof String s) || s.length() != 1) throw new BadInput("expected a one-character string argument");
                return s.charAt(0);
            }
            if (c == String.class || c == CharSequence.class) {
                if (!(v instanceof String s)) throw new BadInput("expected a string argument");
                return s;
            }
            if (c == Object.class) return v;
            if (List.class.isAssignableFrom(c) || c == Collection.class || c == Iterable.class) {
                return convert(new ListOf(Object.class), v);
            }
            throw new BadInput("unsupported parameter type " + c.getTypeName());
        }
        if (t instanceof ParameterizedType p && p.getRawType() instanceof Class<?> raw
                && (raw.isAssignableFrom(ArrayList.class) || raw == LinkedList.class)) {
            if (!(v instanceof List<?> l)) throw new BadInput("expected a list argument");
            List<Object> out = raw == LinkedList.class ? new LinkedList<>() : new ArrayList<>(l.size());
            Type inner = p.getActualTypeArguments()[0];
            if (inner instanceof WildcardType w) inner = w.getUpperBounds()[0];
            for (Object e : l) out.add(convert(inner, e));
            return out;
        }
        if (t instanceof GenericArrayType g) {
            if (!(v instanceof List<?> l)) throw new BadInput("expected an array argument");
            Class<?> comp = rawClass(g.getGenericComponentType());
            Object arr = Array.newInstance(comp, l.size());
            for (int i = 0; i < l.size(); i++) Array.set(arr, i, convert(g.getGenericComponentType(), l.get(i)));
            return arr;
        }
        throw new BadInput("unsupported parameter type " + t.getTypeName());
    }

    private static Class<?> rawClass(Type t) {
        if (t instanceof Class<?> c) return c;
        if (t instanceof ParameterizedType p) return (Class<?>) p.getRawType();
        if (t instanceof GenericArrayType g) return Array.newInstance(rawClass(g.getGenericComponentType()), 0).getClass();
        return Object.class;
    }

    private record ListOf(Type inner) implements ParameterizedType {
        public Type[] getActualTypeArguments() {
            return new Type[] {inner};
        }

        public Type getRawType() {
            return List.class;
        }

        public Type getOwnerType() {
            return null;
        }
    }

    private static long integral(Object v) {
        if (v instanceof Long l) return l;
        if (v instanceof Double d && d == Math.floor(d) && !Double.isInfinite(d)) return d.longValue();
        throw new BadInput("expected an integer argument");
    }

    private static Number number(Object v) {
        if (v instanceof Number n) return n;
        throw new BadInput("expected a number argument");
    }

    /** Minimal JSON: objects -> LinkedHashMap, arrays -> ArrayList, integers -> Long, other numbers -> Double. */
    static final class Json {
        private final String s;
        private int i;

        private Json(String s) {
            this.s = s;
        }

        static Object parse(String s) {
            if (s == null) throw new BadInput("missing input from the judge");
            Json p = new Json(s);
            Object v = p.value();
            return v;
        }

        @SuppressWarnings("unchecked")
        static Map<String, Object> obj(Object o) {
            if (!(o instanceof Map)) throw new BadInput("malformed input from the judge");
            return (Map<String, Object>) o;
        }

        @SuppressWarnings("unchecked")
        static List<Object> arr(Object o) {
            if (!(o instanceof List)) throw new BadInput("malformed input from the judge");
            return (List<Object>) o;
        }

        private void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        }

        private Object value() {
            ws();
            if (i >= s.length()) throw new BadInput("malformed JSON from the judge");
            char c = s.charAt(i);
            if (c == '{') {
                i++;
                Map<String, Object> m = new LinkedHashMap<>();
                ws();
                if (s.charAt(i) == '}') {
                    i++;
                    return m;
                }
                while (true) {
                    ws();
                    String k = string();
                    ws();
                    i++; // ':'
                    m.put(k, value());
                    ws();
                    char d = s.charAt(i++);
                    if (d == '}') return m;
                }
            }
            if (c == '[') {
                i++;
                List<Object> l = new ArrayList<>();
                ws();
                if (s.charAt(i) == ']') {
                    i++;
                    return l;
                }
                while (true) {
                    l.add(value());
                    ws();
                    char d = s.charAt(i++);
                    if (d == ']') return l;
                }
            }
            if (c == '"') return string();
            if (s.startsWith("true", i)) {
                i += 4;
                return Boolean.TRUE;
            }
            if (s.startsWith("false", i)) {
                i += 5;
                return Boolean.FALSE;
            }
            if (s.startsWith("null", i)) {
                i += 4;
                return null;
            }
            int st = i;
            boolean integral = true;
            if (s.charAt(i) == '-') i++;
            while (i < s.length()) {
                char d = s.charAt(i);
                if (Character.isDigit(d)) i++;
                else if (d == '.' || d == 'e' || d == 'E' || d == '+' || d == '-') {
                    integral = false;
                    i++;
                } else break;
            }
            String num = s.substring(st, i);
            if (integral) {
                try {
                    return Long.parseLong(num);
                } catch (NumberFormatException e) {
                    return Double.parseDouble(num);
                }
            }
            return Double.parseDouble(num);
        }

        private String string() {
            StringBuilder b = new StringBuilder();
            i++; // opening quote
            while (true) {
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c != '\\') {
                    b.append(c);
                    continue;
                }
                char e = s.charAt(i++);
                switch (e) {
                    case 'n' -> b.append('\n');
                    case 't' -> b.append('\t');
                    case 'r' -> b.append('\r');
                    case 'b' -> b.append('\b');
                    case 'f' -> b.append('\f');
                    case 'u' -> {
                        b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                        i += 4;
                    }
                    default -> b.append(e);
                }
            }
        }

        static String str(String v) {
            StringBuilder b = new StringBuilder();
            writeString(b, v);
            return b.toString();
        }

        static void writeString(StringBuilder b, String v) {
            b.append('"');
            for (int k = 0; k < v.length(); k++) {
                char c = v.charAt(k);
                switch (c) {
                    case '"' -> b.append("\\\"");
                    case '\\' -> b.append("\\\\");
                    case '\n' -> b.append("\\n");
                    case '\r' -> b.append("\\r");
                    case '\t' -> b.append("\\t");
                    default -> {
                        if (c < 0x20 || c == 0x7f) b.append(String.format("\\u%04x", (int) c));
                        else if (Character.isHighSurrogate(c) && k + 1 < v.length()
                                && Character.isLowSurrogate(v.charAt(k + 1))) {
                            b.append(c).append(v.charAt(++k));
                        } else if (Character.isSurrogate(c)) b.append('�');
                        else b.append(c);
                    }
                }
            }
            b.append('"');
        }

        static void write(StringBuilder b, Object v) {
            if (v == null) b.append("null");
            else if (v instanceof Boolean x) b.append(x ? "true" : "false");
            else if (v instanceof Double d) writeDouble(b, d);
            else if (v instanceof Float f) writeDouble(b, f.doubleValue());
            else if (v instanceof Number n) b.append(n.longValue());
            else if (v instanceof Character c) writeString(b, String.valueOf(c));
            else if (v instanceof CharSequence cs) writeString(b, cs.toString());
            else if (v.getClass().isArray()) {
                b.append('[');
                int n = Array.getLength(v);
                for (int k = 0; k < n; k++) {
                    if (k > 0) b.append(',');
                    write(b, Array.get(v, k));
                }
                b.append(']');
            } else if (v instanceof Iterable<?> it) {
                b.append('[');
                boolean first = true;
                for (Object e : it) {
                    if (!first) b.append(',');
                    first = false;
                    write(b, e);
                }
                b.append(']');
            } else {
                throw new IllegalArgumentException(
                        "cannot convert a return value of type " + v.getClass().getName() + " to the expected result");
            }
        }

        private static void writeDouble(StringBuilder b, double d) {
            if (Double.isNaN(d) || Double.isInfinite(d)) b.append("null");
            else b.append(Double.toString(d));
        }
    }
}
