# Sentiment microservice: loads sklearn joblib and exposes /predict, /predict/batch, /health
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

model = None
vectorizer = None
MAX_BATCH = 50


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global model, vectorizer
    base = os.path.dirname(os.path.abspath(__file__))
    model = joblib.load(os.path.join(base, "sentiment_model.pkl"))
    vectorizer = joblib.load(os.path.join(base, "vectorizer.pkl"))
    yield
    model = None
    vectorizer = None


app = FastAPI(lifespan=lifespan)


class ReviewInput(BaseModel):
    review: str


class BatchReviewInput(BaseModel):
    reviews: list[str] = Field(max_length=MAX_BATCH)


def _predict_one(text: str) -> tuple[str, int, int]:
    assert model is not None and vectorizer is not None
    v = vectorizer.transform([text])
    pred = int(model.predict(v)[0])
    label = "POSITIVE" if pred == 1 else "NEGATIVE"
    score = 1 if pred == 1 else -1
    conf: int
    proba = getattr(model, "predict_proba", None)
    if callable(proba):
        p = proba(v)[0]
        conf = int(round(max(p) * 100))
    else:
        conf = 85
    return label, score, conf


@app.post("/predict")
def predict_sentiment(data: ReviewInput):
    if not data.review or not str(data.review).strip():
        raise HTTPException(status_code=400, detail="empty review")
    label, score, conf = _predict_one(data.review)
    return {
        "review": data.review,
        "sentiment": label,
        "score": score,
        "confidence": conf,
    }


@app.post("/predict/batch")
def predict_batch(data: BatchReviewInput):
    if len(data.reviews) > MAX_BATCH:
        raise HTTPException(
            status_code=400, detail=f"at most {MAX_BATCH} reviews per batch"
        )
    if not data.reviews:
        return {"results": []}
    assert model is not None and vectorizer is not None
    text_vectors = vectorizer.transform(data.reviews)
    preds = model.predict(text_vectors)
    proba = getattr(model, "predict_proba", None)
    pbatch = proba(text_vectors) if callable(proba) else None
    out: list[dict[str, Any]] = []
    for i, (review, pr) in enumerate(zip(data.reviews, preds)):
        pred = int(pr)
        label = "POSITIVE" if pred == 1 else "NEGATIVE"
        score = 1 if pred == 1 else -1
        if pbatch is not None:
            conf = int(round(max(pbatch[i]) * 100))
        else:
            conf = 85
        out.append(
            {
                "review": review,
                "sentiment": label,
                "score": score,
                "confidence": conf,
            }
        )
    return {"results": out}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": model is not None and vectorizer is not None,
    }
