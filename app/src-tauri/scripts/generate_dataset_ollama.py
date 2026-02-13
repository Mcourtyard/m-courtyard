#!/usr/bin/env python3
"""Generate dataset using Ollama local Chat API.

Key design:
 - Uses /api/chat with think:false to disable thinking mode (GLM/Qwen3 etc.)
 - num_predict=2048 to ensure enough tokens for JSON output
 - Reads both 'content' and 'thinking' fields from response
 - Incremental save: each success is appended to file immediately
 - Resume: on restart, skips already-processed segments
 - Emits detailed log events for real-time frontend display
"""

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error

from i18n import t, init_i18n, add_lang_arg


def emit(event_type, **kwargs):
    payload = {"type": event_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def get_system_prompts():
    """Return system prompts per mode using current i18n language."""
    return {
        "qa": t("gen.prompt.qa.system"),
        "style": t("gen.prompt.style.system"),
        "chat": t("gen.prompt.chat.system"),
        "instruct": t("gen.prompt.instruct.system"),
    }


def get_user_templates():
    """Return user message templates per mode using current i18n language."""
    return {
        "qa": t("gen.prompt.qa.user"),
        "style": t("gen.prompt.style.user"),
        "chat": t("gen.prompt.chat.user"),
        "instruct": t("gen.prompt.instruct.user"),
    }


def call_ollama(model: str, system_prompt: str, user_message: str,
                temperature: float = 0.7, num_predict: int = 2048) -> dict:
    """Call Ollama Chat API. Returns the full API response dict for inspection."""
    url = "http://localhost:11434/api/chat"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "stream": False,
        "think": False,
        "options": {
            "num_predict": num_predict,
            "temperature": temperature,
        }
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


def text_similarity(a: str, b: str) -> float:
    """Simple character-level Jaccard similarity between two texts."""
    if not a or not b:
        return 0.0
    # Use character n-grams (bigrams) for comparison
    def bigrams(text):
        text = text.replace(" ", "").replace("\n", "")
        return set(text[i:i+2] for i in range(len(text) - 1)) if len(text) > 1 else {text}
    set_a = bigrams(a)
    set_b = bigrams(b)
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def extract_text_from_response(api_result: dict) -> str:
    """Extract usable text from Ollama response, checking both content and thinking fields."""
    msg = api_result.get("message", {})
    content = msg.get("content", "") or ""
    thinking = msg.get("thinking", "") or ""

    # Prefer content if non-empty
    if content.strip():
        return content.strip()

    # Fallback: try to find JSON inside thinking field
    if thinking.strip():
        return thinking.strip()

    return ""


def repair_json_string(s: str) -> str:
    """Try to fix common JSON issues from LLM output.

    Handles: unescaped quotes within string values, trailing commas,
    unescaped newlines, etc.
    """
    # Replace Chinese quotes with standard quotes
    s = s.replace('\u201c', '"').replace('\u201d', '"')
    s = s.replace('\u2018', "'").replace('\u2019', "'")
    # Fix unescaped newlines within JSON strings
    # (newlines that are not preceded by a backslash)
    # We do this by replacing literal newlines inside string values
    result = []
    in_string = False
    escape_next = False
    for ch in s:
        if escape_next:
            result.append(ch)
            escape_next = False
            continue
        if ch == '\\':
            result.append(ch)
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            result.append(ch)
            continue
        if in_string and ch == '\n':
            result.append('\\n')
            continue
        if in_string and ch == '\t':
            result.append('\\t')
            continue
        result.append(ch)
    return ''.join(result)


def extract_key_value_fallback(text: str, mode: str) -> dict | None:
    """Last-resort extraction: find key fields by regex patterns."""
    if mode in ("style", "instruct"):
        inst_m = re.search(r'"instruction"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
        out_m = re.search(r'"output"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
        if not inst_m or not out_m:
            # Try with greedy match for unescaped quotes in values
            inst_m = re.search(r'"instruction"\s*:\s*"(.+?)"\s*,\s*"output"', text, re.DOTALL)
            out_m = re.search(r'"output"\s*:\s*"(.+?)"\s*}', text, re.DOTALL)
        if inst_m and out_m:
            return {"instruction": inst_m.group(1), "output": out_m.group(1)}
    elif mode == "qa":
        q_m = re.search(r'"question"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
        a_m = re.search(r'"answer"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
        if not q_m or not a_m:
            q_m = re.search(r'"question"\s*:\s*"(.+?)"\s*,\s*"answer"', text, re.DOTALL)
            a_m = re.search(r'"answer"\s*:\s*"(.+?)"\s*}', text, re.DOTALL)
        if q_m and a_m:
            return {"question": q_m.group(1), "answer": a_m.group(1)}
    return None


def parse_json_response(text: str, mode: str = "") -> dict | None:
    """Robustly extract JSON object from model response."""
    if not text:
        return None

    cleaned = text.strip()

    # 1. Strip markdown code blocks: ```json ... ``` or ``` ... ```
    code_block = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', cleaned, re.DOTALL)
    if code_block:
        cleaned = code_block.group(1).strip()

    # 2. Try direct parse
    try:
        obj = json.loads(cleaned)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass

    # 3. Try with JSON repair (fix unescaped quotes/newlines)
    try:
        repaired = repair_json_string(cleaned)
        obj = json.loads(repaired)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass

    # 4. Find outermost balanced { ... } and try parsing
    depth = 0
    start = -1
    for i, ch in enumerate(cleaned):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start >= 0:
                candidate = cleaned[start:i + 1]
                try:
                    obj = json.loads(candidate)
                    if isinstance(obj, dict):
                        return obj
                except json.JSONDecodeError:
                    # Try repair on the candidate
                    try:
                        repaired = repair_json_string(candidate)
                        obj = json.loads(repaired)
                        if isinstance(obj, dict):
                            return obj
                    except json.JSONDecodeError:
                        pass
                start = -1

    # 5. Regex-based key-value extraction as last resort
    if mode:
        result = extract_key_value_fallback(text, mode)
        if result:
            return result

    # 6. Find any JSON-like pattern
    for m in re.finditer(r'\{[^{}]*\}', text):
        try:
            obj = json.loads(m.group())
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            continue

    return None


def to_chat_format(data: dict, mode: str) -> dict | None:
    """Convert to unified chat messages format."""
    if mode == "qa":
        q = data.get("question", "")
        a = data.get("answer", "")
        if q and a:
            return {"messages": [
                {"role": "user", "content": str(q)},
                {"role": "assistant", "content": str(a)},
            ]}
    elif mode in ("style", "instruct"):
        inst = data.get("instruction", "")
        out = data.get("output", "")
        if inst and out:
            return {"messages": [
                {"role": "user", "content": str(inst)},
                {"role": "assistant", "content": str(out)},
            ]}
    elif mode == "chat":
        convs = data.get("conversations", [])
        if convs and len(convs) >= 2:
            return {"messages": convs}
    return None


def load_existing_progress(dataset_dir: str) -> int:
    """Count existing lines in train.jsonl to support resume."""
    train_path = os.path.join(dataset_dir, "train.jsonl")
    if not os.path.exists(train_path):
        return 0
    count = 0
    with open(train_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                count += 1
    return count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--output-dir", default=None, help="Output directory for dataset files")
    parser.add_argument("--model", required=True)
    parser.add_argument("--mode", default="qa", choices=["qa", "style", "chat", "instruct"])
    parser.add_argument("--resume", action="store_true", help="Resume from previous progress")
    add_lang_arg(parser)
    args = parser.parse_args()

    init_i18n(args.lang)

    segments_path = os.path.join(args.project_dir, "cleaned", "segments.jsonl")
    if not os.path.exists(segments_path):
        emit("error", message=t("gen.no_segments"))
        sys.exit(1)

    # Load all segments
    segments = []
    with open(segments_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    obj = json.loads(line)
                    text = obj.get("text", "")
                    if text and len(text) >= 20:
                        segments.append(text)
                except json.JSONDecodeError:
                    continue

    if not segments:
        emit("error", message=t("gen.no_valid_segments"))
        sys.exit(1)

    dataset_dir = args.output_dir if args.output_dir else os.path.join(args.project_dir, "dataset")
    os.makedirs(dataset_dir, exist_ok=True)
    train_path = os.path.join(dataset_dir, "train.jsonl")
    valid_path = os.path.join(dataset_dir, "valid.jsonl")

    # Check for resume
    skip_count = 0
    if args.resume:
        skip_count = load_existing_progress(dataset_dir)
        if skip_count > 0:
            emit("log", message=t("gen.resume_found", skip=skip_count, next=skip_count + 1))

    total = len(segments)
    emit("progress", step=skip_count, total=total,
         desc=t("gen.starting", model=args.model))
    emit("log", message=t("gen.connecting", model=args.model, mode=args.mode, total=total, skip=skip_count))

    # Verify connection with a simple test
    try:
        test_result = call_ollama(args.model, t("gen.test_hello"), t("gen.test_reply"))
        test_content = extract_text_from_response(test_result)
        done_reason = test_result.get("done_reason", "unknown")
        emit("log", message=t("gen.connect_ok", response=test_content[:80], reason=done_reason))
    except Exception as e:
        emit("log", message=t("gen.connect_fail", error=str(e)))
        emit("error", message=t("gen.connect_error", error=str(e)))
        sys.exit(1)

    system_prompt = get_system_prompts()[args.mode]
    user_template = get_user_templates()[args.mode]
    # Use higher temperature for style mode to encourage creativity
    temp = 0.9 if args.mode == "style" else 0.7
    success_count = skip_count
    failed = 0
    similarity_rejected = 0

    # Open files for incremental append
    file_mode = "a" if args.resume and skip_count > 0 else "w"
    train_file = open(train_path, file_mode, encoding="utf-8")

    try:
        for i in range(skip_count, total):
            text = segments[i]
            segment_preview = text[:80].replace("\n", " ")
            emit("log", message=t("gen.segment_header", current=i+1, total=total, preview=segment_preview))

            try:
                user_msg = user_template.format(text=text[:2000])
                # Style mode needs more tokens for creative content
                n_predict = 4096 if args.mode == "style" else 2048
                api_result = call_ollama(args.model, system_prompt, user_msg, temperature=temp, num_predict=n_predict)

                # Extract text from response (handles both content and thinking fields)
                response_text = extract_text_from_response(api_result)
                done_reason = api_result.get("done_reason", "?")

                if not response_text:
                    failed += 1
                    # Dump the raw API response keys for debugging
                    msg_keys = list(api_result.get("message", {}).keys())
                    emit("log", message=t("gen.empty_response", fields=str(msg_keys), reason=done_reason))
                    emit("progress", step=i + 1, total=total,
                         desc=t("gen.progress_status", success=success_count, failed=failed))
                    continue

                # Show AI response
                resp_display = response_text[:300].replace("\n", " ")
                emit("log", message=t("gen.ai_response", length=len(response_text), preview=resp_display))

                # Parse JSON
                data = parse_json_response(response_text, mode=args.mode)
                if data:
                    # Quality check for style mode: reject if output is too similar to input
                    if args.mode == "style":
                        output_text = data.get("output", "")
                        sim = text_similarity(output_text, text)
                        if sim > 0.6:
                            failed += 1
                            similarity_rejected += 1
                            emit("log", message=t("gen.style_rejected", similarity=f"{sim:.0%}"))
                            emit("progress", step=i + 1, total=total,
                                 desc=t("gen.progress_style", success=success_count, failed=failed, rejected=similarity_rejected))
                            continue

                    chat_data = to_chat_format(data, args.mode)
                    if chat_data:
                        success_count += 1
                        # Incremental write
                        train_file.write(json.dumps(chat_data, ensure_ascii=False) + "\n")
                        train_file.flush()
                        emit("log", message=t("gen.success", count=success_count, preview=str(list(data.values())[0])[:60]))
                    else:
                        failed += 1
                        emit("log", message=t("gen.json_mismatch", keys=str(list(data.keys()))))
                else:
                    failed += 1
                    emit("log", message=t("gen.json_parse_fail", text=response_text[:400]))

            except urllib.error.URLError as e:
                failed += 1
                emit("log", message=t("gen.network_error", error=str(e)))
            except Exception as e:
                failed += 1
                emit("log", message=t("gen.exception", type=type(e).__name__, error=str(e)))

            emit("progress", step=i + 1, total=total,
                 desc=t("gen.progress_status", success=success_count, failed=failed))

    finally:
        train_file.close()

    emit("log", message=t("gen.summary", success=success_count, failed=failed, total=total))

    if success_count == 0:
        emit("error", message=t("gen.no_valid_data", total=total))
        sys.exit(1)

    # Write valid.jsonl from the last 10% of train data
    all_results = []
    with open(train_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                all_results.append(line.strip())

    if len(all_results) > 1:
        split_idx = max(1, int(len(all_results) * 0.9))
        valid_lines = all_results[split_idx:]
        train_lines = all_results[:split_idx]

        with open(train_path, "w", encoding="utf-8") as f:
            for line in train_lines:
                f.write(line + "\n")
        with open(valid_path, "w", encoding="utf-8") as f:
            for line in valid_lines:
                f.write(line + "\n")

        emit("log", message=t("gen.saved", train=len(train_lines), valid=len(valid_lines)))
    else:
        # Only one result, copy to both
        with open(valid_path, "w", encoding="utf-8") as f:
            for line in all_results:
                f.write(line + "\n")
        emit("log", message=t("gen.saved", train=len(all_results), valid=len(all_results)))

    emit("complete",
         train_count=success_count,
         failed=failed,
         total=total)


if __name__ == "__main__":
    main()
