# interview++ judge sandbox: Python (CPython 3.15). Build with infra/sandbox/build.sh.
FROM gcc:15.3.0-trixie@sha256:60a0af4b79226d7cb062cc18dcb56f91b4385aace8f6d514f114c3f1af363ef1 AS supervisor
COPY common/ipp-run.c /src/ipp-run.c
RUN gcc -O2 -Wall -Wextra -Werror -static -o /ipp-run /src/ipp-run.c

FROM python:3.15.2-slim-trixie@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928
RUN groupadd -g 10001 sandbox && useradd -u 10001 -g 10001 -d /work -M -s /usr/sbin/nologin sandbox \
 && mkdir -p /work /opt/ipp \
 && find / -xdev -type f -perm /6000 -exec chmod a-s {} + 2>/dev/null; true
COPY --from=supervisor /ipp-run /opt/ipp/ipp-run
COPY python/driver.py /opt/ipp/driver.py
RUN python3 -m compileall -q /opt/ipp && chmod -R a+rX /opt/ipp
ENV LANG=C.UTF-8 HOME=/work PYTHONDONTWRITEBYTECODE=1
WORKDIR /work
USER 10001:10001
LABEL ipp.sandbox.protocol="1" ipp.sandbox.language="python"
CMD ["/opt/ipp/ipp-run", "--idle"]
