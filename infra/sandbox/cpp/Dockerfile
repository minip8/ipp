# interview++ judge sandbox: C++ (GCC 15, C++23). Build with infra/sandbox/build.sh.
FROM gcc:15.3.0-trixie@sha256:60a0af4b79226d7cb062cc18dcb56f91b4385aace8f6d514f114c3f1af363ef1 AS supervisor
COPY common/ipp-run.c /src/ipp-run.c
RUN gcc -O2 -Wall -Wextra -Werror -static -o /ipp-run /src/ipp-run.c

FROM gcc:15.3.0-trixie@sha256:60a0af4b79226d7cb062cc18dcb56f91b4385aace8f6d514f114c3f1af363ef1
# Must match the flags the judge compiles with (crates/judge-harness/src/lang.rs), or the PCH is ignored.
ARG CXXFLAGS="-std=c++23 -O2 -D_GLIBCXX_ASSERTIONS -pipe"
RUN groupadd -g 10001 sandbox && useradd -u 10001 -g 10001 -d /work -M -s /usr/sbin/nologin sandbox \
 && mkdir -p /work /opt/ipp/include/ipp \
 && find / -xdev -type f -perm /6000 -exec chmod a-s {} + 2>/dev/null; true
COPY --from=supervisor /ipp-run /opt/ipp/ipp-run
COPY cpp/support.h /opt/ipp/include/ipp/support.h
COPY cpp/support.cpp /opt/ipp/src/support.cpp
# Precompiled headers: support.h (tests mode: <bits/stdc++.h> + driver support declarations and
# templates) and stdcxx.h (file mode, used when the program includes <bits/stdc++.h>), plus the
# non-template driver code as a static library linked into every tests-mode binary.
RUN printf '#pragma once\n#include <bits/stdc++.h>\n' > /opt/ipp/include/ipp/stdcxx.h \
 && cd /opt/ipp/include/ipp \
 && g++ $CXXFLAGS -x c++-header support.h -o support.h.gch \
 && g++ $CXXFLAGS -x c++-header stdcxx.h -o stdcxx.h.gch \
 && mkdir -p /opt/ipp/lib && cd /opt/ipp/lib \
 && g++ $CXXFLAGS -Wall -Wextra -Werror -I/opt/ipp/include/ipp -c /opt/ipp/src/support.cpp -o support.o \
 && ar rcs libippdriver.a support.o && rm support.o \
 && chmod -R a+rX /opt/ipp
ENV LANG=C.UTF-8 HOME=/work
WORKDIR /work
USER 10001:10001
LABEL ipp.sandbox.protocol="1" ipp.sandbox.language="cpp"
CMD ["/opt/ipp/ipp-run", "--idle"]
