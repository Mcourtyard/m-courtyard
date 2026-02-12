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


def emit(event_type, **kwargs):
    payload = {"type": event_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


# ── System prompts per mode ───────────

SYSTEM_PROMPTS = {
    "qa": (
        "你是一个专业的训练数据生成专家。你的任务是根据给定文本，生成一个高质量的问答对。\n"
        "要求：\n"
        "1. 问题应该有深度，不要简单的事实提取，要考验理解力和分析力\n"
        "2. 问题类型要多样：可以是理解型、分析型、推理型、应用型\n"
        "3. 答案要完整、有条理，包含足够的细节和解释\n"
        "4. 答案应基于文本内容但用自己的语言组织，不要直接复制原文\n"
        "5. 直接输出JSON，格式：{\"question\": \"...\", \"answer\": \"...\"}"
    ),
    "style": (
        "你是一个写作风格分析与模仿专家。你的任务是：\n"
        "1. 深入分析给定写作样本的风格特征（包括：用词习惯、句式结构、修辞手法、叙事视角、情感基调、节奏韵律等）\n"
        "2. 基于分析出的风格，创建一条\"写作指令\"和\"风格化回复\"：\n"
        "   - instruction（写作指令）：一个创意写作提示，要求撰写一段全新内容（新场景、新人物、新情节），但要求保持与原文一致的写作风格\n"
        "   - output（风格化回复）：根据指令创作的全新文本，完美体现原文的写作风格特征\n\n"
        "极其重要的规则：\n"
        "- output 必须是你全新创作的内容，绝对不能复制、改写或总结原文\n"
        "- output 的场景、人物、情节必须与原文完全不同\n"
        "- output 的写作风格（用词、句式、修辞、语气）必须与原文高度一致\n"
        "- instruction 不要包含原文内容，只描述写作任务\n"
        "直接输出JSON，格式：{\"instruction\": \"...\", \"output\": \"...\"}"
    ),
    "chat": (
        "你是一个专业的对话数据生成专家。你的任务是将给定文本转换为自然、有深度的多轮对话（至少3轮）。\n"
        "要求：\n"
        "1. 对话应该自然流畅，像真实的师生问答或朋友讨论\n"
        "2. 用户的问题应层层递进，从基础问题到深入探讨\n"
        "3. 助手的回答应专业、详细，引导对话深入\n"
        "4. 包含追问、澄清、举例等自然对话元素\n"
        "5. 不要简单地把文本拆分成对话，而是围绕文本主题展开讨论\n"
        "直接输出JSON，格式：{\"conversations\": [{\"role\": \"user\", \"content\": \"...\"}, {\"role\": \"assistant\", \"content\": \"...\"}]}"
    ),
    "instruct": (
        "你是一个专业的指令数据生成专家。你的任务是根据给定文本生成一个高质量的指令-输出对。\n"
        "要求：\n"
        "1. 指令类型要多样化，可以是：总结、分析、比较、推理、解释、改写、扩展、评价等\n"
        "2. 指令应该明确、具体，让模型知道需要做什么\n"
        "3. 输出应该高质量、有条理，展示良好的理解和表达能力\n"
        "4. 输出不要直接复制原文，而是基于理解后用自己的语言重新组织\n"
        "直接输出JSON，格式：{\"instruction\": \"...\", \"output\": \"...\"}"
    ),
}

USER_TEMPLATES = {
    "qa": (
        "请根据以下文本生成一个有深度的问答对。问题应考验理解和分析能力，"
        "答案要完整有条理。只输出JSON。\n\n"
        "【文本内容】\n{text}"
    ),
    "style": (
        "请仔细分析以下写作样本的风格特征（用词、句式、修辞、语气、节奏等），"
        "然后创建一条全新的写作指令和对应的风格化回复。\n"
        "注意：output必须是全新创作，场景和内容与原文完全不同，但写作风格高度一致。"
        "只输出JSON。\n\n"
        "【写作样本】\n{text}"
    ),
    "chat": (
        "请将以下文本的内容转化为一段自然的多轮对话（至少3轮往返）。"
        "对话应层层递进，包含追问和深入探讨。只输出JSON。\n\n"
        "【文本内容】\n{text}"
    ),
    "instruct": (
        "请根据以下文本生成一个高质量的指令-输出对。"
        "指令类型请从以下中选择：总结要点、深入分析、对比说明、因果推理、概念解释、观点评价。"
        "只输出JSON。\n\n"
        "【文本内容】\n{text}"
    ),
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
    args = parser.parse_args()

    segments_path = os.path.join(args.project_dir, "cleaned", "segments.jsonl")
    if not os.path.exists(segments_path):
        emit("error", message="未找到 segments.jsonl，请先执行清洗。")
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
        emit("error", message="未找到有效的文本段落。")
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
            emit("log", message=f"🔄 检测到已有 {skip_count} 条数据，从第 {skip_count + 1} 段继续...")

    total = len(segments)
    emit("progress", step=skip_count, total=total,
         desc=f"使用 [{args.model}] 生成数据集...")
    emit("log", message=f"📡 连接 Ollama...\n   模型: {args.model}\n   模式: {args.mode}\n   文本段数: {total}\n   跳过已完成: {skip_count}")

    # Verify connection with a simple test
    try:
        test_result = call_ollama(args.model, "你好", "回复OK", )
        test_content = extract_text_from_response(test_result)
        done_reason = test_result.get("done_reason", "unknown")
        emit("log", message=f"✅ Ollama 连接成功\n   模型响应: {test_content[:80]}\n   完成原因: {done_reason}")
    except Exception as e:
        emit("log", message=f"❌ Ollama 连接失败: {e}")
        emit("error", message=f"无法连接 Ollama: {e}")
        sys.exit(1)

    system_prompt = SYSTEM_PROMPTS[args.mode]
    user_template = USER_TEMPLATES[args.mode]
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
            emit("log", message=f"\n── 第 {i+1}/{total} 段 ──\n📄 文本: {segment_preview}...")

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
                    emit("log", message=f"❌ AI返回空内容\n   响应字段: {msg_keys}\n   done_reason: {done_reason}")
                    emit("progress", step=i + 1, total=total,
                         desc=f"已生成 {success_count} 条（{failed} 失败）")
                    continue

                # Show AI response
                resp_display = response_text[:300].replace("\n", " ")
                emit("log", message=f"🤖 AI返回({len(response_text)}字): {resp_display}")

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
                            emit("log", message=f"⚠️ 风格模式质量检测：output与原文相似度过高({sim:.0%})，已跳过")
                            emit("progress", step=i + 1, total=total,
                                 desc=f"已生成 {success_count} 条（{failed} 失败，{similarity_rejected} 相似度过高）")
                            continue

                    chat_data = to_chat_format(data, args.mode)
                    if chat_data:
                        success_count += 1
                        # Incremental write
                        train_file.write(json.dumps(chat_data, ensure_ascii=False) + "\n")
                        train_file.flush()
                        emit("log", message=f"✅ 成功! 已累计 {success_count} 条\n   Q: {str(list(data.values())[0])[:60]}...")
                    else:
                        failed += 1
                        emit("log", message=f"⚠️ JSON字段不匹配: {list(data.keys())}")
                else:
                    failed += 1
                    emit("log", message=f"❌ JSON解析失败\n   AI原文: {response_text[:400]}")

            except urllib.error.URLError as e:
                failed += 1
                emit("log", message=f"❌ 网络错误: {e}")
            except Exception as e:
                failed += 1
                emit("log", message=f"❌ 异常: {type(e).__name__}: {e}")

            emit("progress", step=i + 1, total=total,
                 desc=f"已生成 {success_count} 条（{failed} 失败）")

    finally:
        train_file.close()

    emit("log", message=f"\n══ 生成完毕 ══\n   ✅ 成功: {success_count}\n   ❌ 失败: {failed}\n   📊 总计: {total}")

    if success_count == 0:
        emit("error", message=f"未生成有效数据（{total}段全部失败）。请查看AI日志排查原因。")
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

        emit("log", message=f"💾 已保存: train.jsonl ({len(train_lines)}条), valid.jsonl ({len(valid_lines)}条)")
    else:
        # Only one result, copy to both
        with open(valid_path, "w", encoding="utf-8") as f:
            for line in all_results:
                f.write(line + "\n")
        emit("log", message=f"💾 已保存: train.jsonl ({len(all_results)}条), valid.jsonl ({len(all_results)}条)")

    emit("complete",
         train_count=success_count,
         failed=failed,
         total=total)


if __name__ == "__main__":
    main()
