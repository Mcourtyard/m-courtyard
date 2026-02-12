#!/usr/bin/env python3
"""Built-in rule-based dataset generation without AI dependency.

Generates training data using NLP heuristics:
- Heading-based Q&A extraction
- Key sentence extraction + template filling
- Paragraph → instruction-output conversion
"""

import argparse
import json
import os
import re
import sys
import random


def emit(event_type, **kwargs):
    payload = {"type": event_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


# ── Rule-based generators ──────────────────────────────────────────

def extract_heading_qa(text: str) -> list[dict]:
    """Extract Q&A pairs from heading-like lines."""
    results = []
    lines = text.strip().split("\n")
    heading_pattern = re.compile(r'^#{1,6}\s+(.+)$|^(.{5,30})[：:]$|^第[一二三四五六七八九十\d]+[章节部分]\s*(.+)$')

    for i, line in enumerate(lines):
        match = heading_pattern.match(line.strip())
        if match:
            heading = match.group(1) or match.group(2) or match.group(3)
            if not heading:
                continue
            # Collect following paragraph as answer
            body_lines = []
            for j in range(i + 1, min(i + 20, len(lines))):
                next_line = lines[j].strip()
                if not next_line:
                    if body_lines:
                        break
                    continue
                if heading_pattern.match(next_line):
                    break
                body_lines.append(next_line)

            if body_lines and len("".join(body_lines)) >= 20:
                answer = "\n".join(body_lines)
                question = f"请介绍一下{heading.strip('# ').strip()}"
                results.append({
                    "messages": [
                        {"role": "user", "content": question},
                        {"role": "assistant", "content": answer},
                    ]
                })
    return results


def extract_sentence_qa(text: str) -> list[dict]:
    """Generate Q&A from key sentences using templates."""
    results = []
    # Split into sentences
    sentences = re.split(r'[。！？\n]+', text)
    sentences = [s.strip() for s in sentences if len(s.strip()) >= 15]

    templates_zh = [
        ("请解释：{topic}", "{content}"),
        ("关于{topic}，你能详细说明吗？", "{content}"),
        ("{topic}是什么？", "{content}"),
        ("请描述{topic}的相关内容。", "{content}"),
    ]

    templates_en = [
        ("Explain: {topic}", "{content}"),
        ("What is {topic}?", "{content}"),
        ("Describe {topic}.", "{content}"),
        ("Tell me about {topic}.", "{content}"),
    ]

    for sent in sentences:
        if len(sent) > 200:
            continue
        # Detect language
        has_cjk = bool(re.search(r'[\u4e00-\u9fff]', sent))
        templates = templates_zh if has_cjk else templates_en

        # Extract topic (first noun phrase or first clause)
        if has_cjk:
            # Take first meaningful segment
            parts = re.split(r'[，,；;、]', sent)
            topic = parts[0][:20] if parts else sent[:20]
        else:
            parts = re.split(r'[,;]', sent)
            topic = parts[0][:40] if parts else sent[:40]

        template = random.choice(templates)
        q = template[0].format(topic=topic)
        a = template[1].format(content=sent)

        results.append({
            "messages": [
                {"role": "user", "content": q},
                {"role": "assistant", "content": a},
            ]
        })

    return results


def paragraph_to_style(text: str) -> list[dict]:
    """Convert paragraphs to style-imitation training format.

    For style fine-tuning, the model learns to respond in the target writing style.
    - instruction: A creative writing prompt asking for content in the target style
    - output: The original text (as a style exemplar for the model to learn from)
    """
    results = []
    paragraphs = text.split("\n\n")
    paragraphs = [p.strip() for p in paragraphs if len(p.strip()) >= 30]

    style_templates_zh = [
        "请模仿上述写作风格，撰写一段描述性文字。",
        "请以相同的写作风格，创作一段新的内容。",
        "请保持这种文字风格，续写一段相关内容。",
        "请用同样的语言风格和表达方式，写一段文字。",
        "请模仿这种叙事风格，创作一段新的段落。",
        "请用相同的修辞手法和语气，撰写一段文字。",
    ]

    style_templates_en = [
        "Write a descriptive passage in the same writing style.",
        "Create new content maintaining the same writing style.",
        "Continue writing in the same literary style and tone.",
        "Compose a new paragraph using the same narrative voice.",
        "Write a passage mimicking this author's style and rhetoric.",
    ]

    for para in paragraphs:
        if len(para) > 2000:
            para = para[:2000]
        has_cjk = bool(re.search(r'[\u4e00-\u9fff]', para))
        templates = style_templates_zh if has_cjk else style_templates_en
        instruction = random.choice(templates)

        results.append({
            "messages": [
                {"role": "user", "content": instruction},
                {"role": "assistant", "content": para},
            ]
        })

    return results


def paragraph_to_instruct(text: str) -> list[dict]:
    """Convert paragraphs to instruction-output format."""
    results = []
    paragraphs = text.split("\n\n")
    paragraphs = [p.strip() for p in paragraphs if len(p.strip()) >= 30]

    instruct_templates_zh = [
        "请总结以下内容的要点：",
        "请用简洁的语言概括以下文字：",
        "请分析以下文本的主要观点：",
        "请对以下内容进行解读：",
        "请解释以下文字的深层含义：",
        "请从不同角度分析以下内容：",
    ]

    instruct_templates_en = [
        "Summarize the key points of the following:",
        "Briefly describe the following text:",
        "Analyze the main ideas in the following:",
        "Interpret the following content:",
        "Explain the deeper meaning of the following:",
        "Analyze the following from different perspectives:",
    ]

    for para in paragraphs:
        if len(para) > 2000:
            para = para[:2000]
        has_cjk = bool(re.search(r'[\u4e00-\u9fff]', para))
        templates = instruct_templates_zh if has_cjk else instruct_templates_en
        instruction = random.choice(templates)

        # For instruct mode, use the paragraph as context and generate a structured response
        results.append({
            "messages": [
                {"role": "user", "content": f"{instruction}\n\n{para}"},
                {"role": "assistant", "content": para},
            ]
        })

    return results


# ── Main ───────────────────────────────────────────────────────────

def generate_builtin(segments: list[str], mode: str) -> list[dict]:
    """Generate dataset using rule-based methods."""
    all_results = []

    for text in segments:
        if mode == "qa":
            # Try heading extraction first, fallback to sentence extraction
            items = extract_heading_qa(text)
            if not items:
                items = extract_sentence_qa(text)
            all_results.extend(items)
        elif mode == "style":
            # For style, use dedicated style-imitation format
            all_results.extend(paragraph_to_style(text))
        elif mode == "chat":
            # For chat, generate simple Q&A pairs
            items = extract_sentence_qa(text)
            all_results.extend(items)
        elif mode == "instruct":
            all_results.extend(paragraph_to_instruct(text))

    return all_results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--output-dir", default=None, help="Output directory for dataset files")
    parser.add_argument("--mode", default="qa", choices=["qa", "style", "chat", "instruct"])
    args = parser.parse_args()

    segments_path = os.path.join(args.project_dir, "cleaned", "segments.jsonl")
    if not os.path.exists(segments_path):
        emit("error", message="No segments.jsonl found. Run cleaning first.")
        sys.exit(1)

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
        emit("error", message="No valid segments found.")
        sys.exit(1)

    total = len(segments)
    emit("progress", step=0, total=total, desc="Starting built-in rule-based generation...")

    results = []
    for i, text in enumerate(segments):
        items = generate_builtin([text], args.mode)
        results.extend(items)
        emit("progress", step=i + 1, total=total,
             desc=f"Generated {len(results)} samples")

    if not results:
        emit("error", message="No valid samples generated from the text.")
        sys.exit(1)

    # Shuffle and deduplicate
    random.shuffle(results)
    seen = set()
    unique_results = []
    for item in results:
        key = json.dumps(item, ensure_ascii=False, sort_keys=True)
        if key not in seen:
            seen.add(key)
            unique_results.append(item)
    results = unique_results

    # Write train/valid split
    dataset_dir = args.output_dir if args.output_dir else os.path.join(args.project_dir, "dataset")
    os.makedirs(dataset_dir, exist_ok=True)

    split_idx = max(1, int(len(results) * 0.9))
    train_data = results[:split_idx]
    valid_data = results[split_idx:] if split_idx < len(results) else results[-1:]

    with open(os.path.join(dataset_dir, "train.jsonl"), "w", encoding="utf-8") as f:
        for item in train_data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    with open(os.path.join(dataset_dir, "valid.jsonl"), "w", encoding="utf-8") as f:
        for item in valid_data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    emit("complete",
         train_count=len(train_data),
         valid_count=len(valid_data),
         failed=0,
         total=total)


if __name__ == "__main__":
    main()
