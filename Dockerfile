FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash supermemory

USER supermemory
WORKDIR /home/supermemory

ENV SUPERMEMORY_NO_PROMPT=1
ENV SUPERMEMORY_DATA_DIR=/home/supermemory/data

RUN mkdir -p /home/supermemory/data && \
    curl -fsSL https://supermemory.ai/install | bash && \
    chown -R supermemory:supermemory /home/supermemory/data && \
    chmod -R 755 /home/supermemory/data

EXPOSE 6767

ENTRYPOINT ["/home/supermemory/.local/bin/supermemory-server"]
