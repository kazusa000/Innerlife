from __future__ import annotations

import os
from typing import Iterable

from fastapi import FastAPI
from ltp import LTP
from pydantic import BaseModel


MODEL_NAME = os.environ.get("MAS_LTP_MODEL", "LTP/small")
HOST = os.environ.get("MAS_LTP_HOST", "0.0.0.0")
PORT = int(os.environ.get("MAS_LTP_PORT", "7788"))

app = FastAPI(title="MAS LTP Service")
ltp = LTP(MODEL_NAME)


class AnalyzeRequest(BaseModel):
    text: str


class AnalyzeResponse(BaseModel):
    candidates: list[str]


RECALL_SCAFFOLD = {
    "你", "我", "我们", "还", "记得", "想起", "之前", "以前", "先前", "上次",
    "提到", "说过", "聊过", "那个", "这个", "这些", "那些", "吗", "么", "呢",
    "吧", "呀", "啊", "了", "的", "得", "着", "内容", "事情", "对话", "讨论",
    "这件事", "那件事",
}

TIME_HINTS = {
    "今天", "昨天", "前天", "明天", "刚刚", "刚才", "最近", "刚", "上午", "下午",
    "晚上", "凌晨", "今早", "今晨", "昨晚", "上周", "下周", "周一", "周二",
    "周三", "周四", "周五", "周六", "周日",
}

PUNCT = {"，", "。", "？", "！", "、", ",", ".", "?", "!", "：", ":"}


def is_ascii_token(token: str) -> bool:
    return token.isascii() and any(ch.isalnum() for ch in token)


def normalize_token(token: str) -> str:
    return token.strip()


def keep_token(token: str, pos: str) -> bool:
    token = normalize_token(token)
    if not token or token in PUNCT:
        return False
    if token in RECALL_SCAFFOLD or token in TIME_HINTS:
        return False
    if is_ascii_token(token):
        return True
    return pos.startswith(("n", "j", "i", "b")) or pos in {"ws", "nz", "nh", "ni", "ns"}


def dedupe(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def extract_candidates(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []

    result = ltp.pipeline([text], tasks=["cws", "pos", "ner"])
    tokens = result.cws[0]
    pos_tags = result.pos[0]

    kept_tokens = [normalize_token(token) for token, pos in zip(tokens, pos_tags) if keep_token(token, pos)]
    joined = "".join(kept_tokens)

    noun_like = [
        normalize_token(token)
        for token, pos in zip(tokens, pos_tags)
        if normalize_token(token)
        and normalize_token(token) not in RECALL_SCAFFOLD
        and normalize_token(token) not in TIME_HINTS
        and normalize_token(token) not in PUNCT
        and (is_ascii_token(token) or pos.startswith("n") or pos in {"j", "b", "i", "ws", "nz", "nh", "ni", "ns"})
    ]
    noun_joined = "".join(noun_like)
    longest_token = max(kept_tokens, key=len, default="")

    return dedupe([joined, noun_joined, longest_token])[:3]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    return AnalyzeResponse(candidates=extract_candidates(req.text))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
