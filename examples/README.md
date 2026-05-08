# Example Databases

This directory contains clean demo SQLite databases for trying Innerlife without using private local data.

- `zh/` contains a Chinese Amadeus sample.
- `en/` contains an English Amadeus sample.

Each sample has the same runtime layout as the app:

```text
storage/app/data.db
storage/memory/memory.db
```

To use one sample locally, copy its `storage/` directory to the project root before starting the web app:

```bash
rm -rf storage
cp -r examples/zh/storage ./storage
```

Use `examples/en/storage` instead for the English sample.

The sample databases include one agent, one empty session, relationship counterparts, short-term memories, episodic memories, entity aliases, weighted entity edges, observed time ranges, and precomputed memory embeddings. They do not include private chat messages, LLM call logs, observer traces, or tool execution logs.
