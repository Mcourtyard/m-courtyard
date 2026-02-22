#!/usr/bin/env python3
"""
Courtyard - AI dataset generation script.
Uses mlx-lm to generate Q&A pairs from cleaned text segments.
Input:  --project-dir <path> --model <model_path_or_id> --mode <qa|style|chat|instruct>
Output: train.jsonl + valid.jsonl in <project-dir>/dataset/
Progress: JSON lines to stdout
"""
import argparse
import json
import os
import random
import sys

from i18n import init_i18n, add_lang_arg


def emit(event_type, **kwargs):
    payload = {"type": event_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


MODE_PROMPTS = {
    "qa": (
        "Based on the following text, generate a question and answer pair for training a knowledge Q&A model. "
        "Output ONLY valid JSON with keys \"question\" and \"answer\". No extra text.\n\n"
        "Text:\n{text}\n\nJSON:"
    ),
    "style": (
        "Based on the following writing sample, generate a writing prompt and a response that mimics the style. "
        "Output ONLY valid JSON with keys \"instruction\" and \"output\". No extra text.\n\n"
        "Sample:\n{text}\n\nJSON:"
    ),
    "chat": (
        "Convert the following text into a multi-turn conversation between a user and an assistant. "
        "Output ONLY valid JSON with key \"conversations\" containing a list of {{\"role\": \"user\"|\"assistant\", \"content\": \"...\"}} objects.\n\n"
        "Text:\n{text}\n\nJSON:"
    ),
    "instruct": (
        "Based on the following text, generate an instruction-output pair for training. "
        "Output ONLY valid JSON with keys \"instruction\" and \"output\". No extra text.\n\n"
        "Text:\n{text}\n\nJSON:"
    ),
}


def generate_with_mlx(model, tokenizer, prompt, max_tokens=512):
    """Generate text using mlx-lm."""
    from mlx_lm import generate as mlx_generate
    response = mlx_generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        verbose=False,
    )
    return response


def parse_json_response(response_text):
    """Try to extract valid JSON from model response."""
    # Try direct parse
    try:
        return json.loads(response_text.strip())
    except json.JSONDecodeError:
        pass

    # Try to find JSON in the response
    import re
    json_match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    # Try array match for chat mode
    array_match = re.search(r'\{[^{}]*"conversations"[^{}]*\[.*?\][^{}]*\}', response_text, re.DOTALL)
    if array_match:
        try:
            return json.loads(array_match.group())
        except json.JSONDecodeError:
            pass

    return None


def to_chat_format(data, mode):
    """Convert generated data to chat template format for training."""
    messages = []
    if mode == "qa":
        q = data.get("question", "")
        a = data.get("answer", "")
        if q and a:
            messages = [
                {"role": "user", "content": q},
                {"role": "assistant", "content": a},
            ]
    elif mode in ("style", "instruct"):
        inst = data.get("instruction", "")
        out = data.get("output", "")
        if inst and out:
            messages = [
                {"role": "user", "content": inst},
                {"role": "assistant", "content": out},
            ]
    elif mode == "chat":
        convs = data.get("conversations", [])
        if convs:
            messages = convs
    return messages


def load_segments_from_file(path):
    """Load segments from jsonl/text and normalize to dict records with text."""
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                raw_obj = json.loads(line)
            except json.JSONDecodeError:
                raw_obj = {"text": line}

            if isinstance(raw_obj, dict):
                text = str(raw_obj.get("text", "")).strip()
                record = dict(raw_obj)
            elif isinstance(raw_obj, str):
                text = raw_obj.strip()
                record = {"text": text}
            else:
                continue

            if len(text) < 20:
                continue

            record["text"] = text
            records.append(record)

    return records


def compute_quality_score(total, success, avg_output_len):
    if total <= 0:
        return 0.0, "C"
    success_rate = success / total
    reliability_score = success_rate * 70.0
    richness_score = min(avg_output_len / 280.0, 1.0) * 20.0
    volume_score = min(success / 10.0, 1.0) * 10.0
    score = round(reliability_score + richness_score + volume_score, 1)
    if score >= 85:
        grade = "A"
    elif score >= 70:
        grade = "B"
    else:
        grade = "C"
    return score, grade


def main():
    parser = argparse.ArgumentParser(description="Courtyard dataset generation")
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--output-dir", default=None, help="Output directory for dataset files")
    parser.add_argument("--model", required=True, help="Model path or HuggingFace ID")
    parser.add_argument("--mode", default="qa", choices=["qa", "style", "chat", "instruct"])
    parser.add_argument("--max-samples", type=int, default=0, help="Max samples (0=all)")
    parser.add_argument("--split-ratio", type=float, default=0.9, help="Train/valid split")
    parser.add_argument("--input-segments", default=None, help="Optional segments jsonl input path")
    parser.add_argument("--quality-scoring", action="store_true", help="Enable post-generation quality scoring")
    add_lang_arg(parser)
    args = parser.parse_args()

    init_i18n(args.lang)

    dataset_dir = args.output_dir if args.output_dir else os.path.join(args.project_dir, "dataset")
    os.makedirs(dataset_dir, exist_ok=True)

    segments_path = args.input_segments or os.path.join(args.project_dir, "cleaned", "segments.jsonl")
    if not os.path.exists(segments_path):
        emit("error", message="No cleaned segments found. Run cleaning first.")
        sys.exit(1)

    # Load segments
    segment_records = load_segments_from_file(segments_path)
    segments = [{"text": rec["text"]} for rec in segment_records]

    if not segments:
        emit("error", message="No segments found in cleaned data.")
        sys.exit(1)

    if args.max_samples > 0:
        segments = segments[:args.max_samples]

    total = len(segments)
    emit("progress", step=0, total=total, desc="Loading model...")

    # Load model
    try:
        from mlx_lm import load
        model, tokenizer = load(args.model)
        emit("progress", step=0, total=total, desc="Model loaded. Generating dataset...")
    except Exception as e:
        emit("error", message=f"Failed to load model: {e}")
        sys.exit(1)

    prompt_template = MODE_PROMPTS[args.mode]
    results = []
    failed = 0
    failed_records = []
    output_lengths = []

    for i, seg in enumerate(segments):
        segment_record = dict(segment_records[i]) if i < len(segment_records) else {"text": seg.get("text", "")}
        text = seg["text"]
        # Truncate very long segments
        if len(text) > 2000:
            text = text[:2000]

        prompt = prompt_template.format(text=text)

        try:
            response = generate_with_mlx(model, tokenizer, prompt, max_tokens=512)
            parsed = parse_json_response(response)
            if parsed:
                messages = to_chat_format(parsed, args.mode)
                if messages:
                    results.append({"messages": messages})
                    output_lengths.append(sum(len(str(m.get("content", ""))) for m in messages if isinstance(m, dict)))
                else:
                    failed += 1
                    failed_records.append({**segment_record, "reason": "schema_mismatch"})
            else:
                failed += 1
                failed_records.append({**segment_record, "reason": "json_parse"})
        except Exception as e:
            emit("warning", message=f"Generation failed for segment {i}: {e}")
            failed += 1
            failed_records.append({**segment_record, "reason": type(e).__name__})

        emit("progress", step=i + 1, total=total,
             desc=f"Generated {len(results)} samples ({failed} failed)")

    if not results:
        emit("error", message="No valid samples generated.")
        sys.exit(1)

    # Shuffle and split
    random.shuffle(results)
    split_idx = int(len(results) * args.split_ratio)
    train_data = results[:split_idx]
    valid_data = results[split_idx:]

    # Ensure at least 1 validation sample
    if not valid_data and len(train_data) > 1:
        valid_data = [train_data.pop()]

    # Write output
    train_path = os.path.join(dataset_dir, "train.jsonl")
    valid_path = os.path.join(dataset_dir, "valid.jsonl")

    with open(train_path, "w", encoding="utf-8") as f:
        for item in train_data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    with open(valid_path, "w", encoding="utf-8") as f:
        for item in valid_data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    failed_path = os.path.join(dataset_dir, "failed_segments.jsonl")
    with open(failed_path, "w", encoding="utf-8") as f:
        for rec in failed_records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    if args.quality_scoring:
        avg_output_len = (sum(output_lengths) / len(output_lengths)) if output_lengths else 0.0
        score, grade = compute_quality_score(total=total, success=len(results), avg_output_len=avg_output_len)
        quality_payload = {
            "score": score,
            "grade": grade,
            "success": len(results),
            "failed": failed,
            "total": total,
            "success_rate": round((len(results) / total) if total > 0 else 0.0, 4),
            "avg_output_len": round(avg_output_len, 1),
        }
        quality_path = os.path.join(dataset_dir, "quality.json")
        with open(quality_path, "w", encoding="utf-8") as f:
            json.dump(quality_payload, f, ensure_ascii=False, indent=2)

    emit("complete",
         total_segments=total,
         generated=len(results),
         failed=failed,
         train_count=len(train_data),
         valid_count=len(valid_data))


if __name__ == "__main__":
    main()
