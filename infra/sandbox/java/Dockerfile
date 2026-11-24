# interview++ judge sandbox: Java (Temurin 25 LTS). Build with infra/sandbox/build.sh.
FROM gcc:15.3.0-trixie@sha256:60a0af4b79226d7cb062cc18dcb56f91b4385aace8f6d514f114c3f1af363ef1 AS supervisor
COPY common/ipp-run.c /src/ipp-run.c
RUN gcc -O2 -Wall -Wextra -Werror -static -o /ipp-run /src/ipp-run.c

FROM eclipse-temurin:25.0.5.1_2-jdk-noble@sha256:c7eef3dfeb81468533ea48c67bddaa8c7ca916454259e4d0d734d12bcff8e125
RUN groupadd -g 10001 sandbox && useradd -u 10001 -g 10001 -d /work -M -s /usr/sbin/nologin sandbox \
 && mkdir -p /work /opt/ipp \
 && find / -xdev -type f -perm /6000 -exec chmod a-s {} + 2>/dev/null; true
COPY --from=supervisor /ipp-run /opt/ipp/ipp-run
COPY java/IppDriver.java /opt/ipp/java-src/IppDriver.java
COPY java/Warmup.java /opt/ipp/java-src/Warmup.java
# Driver classes, plus class-data-sharing archives for javac and for the driver so JVM startup
# (paid on every compile and every driver start) is shorter.
RUN mkdir -p /tmp/drv /tmp/warm/classes && javac -d /tmp/drv /opt/ipp/java-src/IppDriver.java \
 && jar --create --file /opt/ipp/ipp-driver.jar -C /tmp/drv . \
 && cp /opt/ipp/java-src/Warmup.java /tmp/warm/Main.java \
 && javac -J-XX:ArchiveClassesAtExit=/opt/ipp/javac.jsa -J-XX:+UseSerialGC -d /tmp/warm/classes /tmp/warm/Main.java \
 && printf '{"nonce":"x","className":"java.util.ArrayList"}\n{"ctorArgs":[],"calls":[{"method":"add","args":[[1,2.5,"s",true]]},{"method":"size","args":[]}]}\n' > /tmp/warm/in \
 && java -XX:ArchiveClassesAtExit=/opt/ipp/driver.jsa -XX:+UseSerialGC -cp /opt/ipp/ipp-driver.jar IppDriver 3</tmp/warm/in \
 && rm -rf /tmp/warm /tmp/drv && chmod -R a+rX /opt/ipp
ENV LANG=C.UTF-8 HOME=/work
WORKDIR /work
USER 10001:10001
LABEL ipp.sandbox.protocol="1" ipp.sandbox.language="java"
CMD ["/opt/ipp/ipp-run", "--idle"]
