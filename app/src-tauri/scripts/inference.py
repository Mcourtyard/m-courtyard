#!/usr/bin/env python3
"""
Courtyard - Model inference script.
Streams tokens to stdout for the Rust backend to relay to the frontend.
Input:  --model <path> --adapter-path <path> --prompt <text> --max-tokens <n> --temp <f>
Output: JSON lines to stdout (token events + completion)
"""
import argparse
import json
import sys


def emit(event_type, **kwargs):
    payload = {"type": event_type, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Courtyard model inference")
    parser.add_argument("--model", required=True, help="Base model path or HF ID")
    parser.add_argument("--adapter-path", default="", help="LoRA adapter path")
    parser.add_argument("--prompt", required=True, help="User prompt text")
    parser.add_argument("--max-tokens", type=int, default=512)
    parser.add_argument("--temp", type=float, default=0.7)
    parser.add_argument("--top-p", type=float, default=0.9)
    args = parser.parse_args()

    emit("status", message="Loading model...")

    try:
        import os
        from mlx_lm import load, generate

        # Pre-check model availability
        model_path = args.model
        is_local_path = model_path.startswith("/") or model_path.startswith("~") or model_path.startswith(".")
        if is_local_path:
            # Absolute or relative local path — verify it exists
            expanded = os.path.expanduser(model_path)
            if not os.path.isdir(expanded):
                emit("error", message=f"Model directory not found: {model_path}")
                sys.exit(1)
            config_path = os.path.join(expanded, "config.json")
            if not os.path.isfile(config_path):
                emit("error", message=f"Model config.json not found at: {expanded}. This may not be a valid MLX model directory.")
                sys.exit(1)
        else:
            # HuggingFace model ID (e.g. "mlx-community/Qwen2.5-3B-Instruct-4bit")
            # Check if it's in the local HF cache; if not, mlx_lm.load will try to download
            hf_cache = os.path.expanduser("~/.cache/huggingface/hub")
            cache_dir = os.path.join(hf_cache, f"models--{model_path.replace('/', '--')}")
            if not os.path.isdir(cache_dir):
                emit("status", message=f"Model {model_path} not in local cache, mlx_lm will attempt to download...")

        load_kwargs = {}
        if args.adapter_path and args.adapter_path.strip():
            adapter_dir = args.adapter_path
            if not os.path.isdir(adapter_dir):
                emit("error", message=f"Adapter directory not found: {adapter_dir}")
                sys.exit(1)
            load_kwargs["adapter_path"] = adapter_dir

        model, tokenizer = load(args.model, **load_kwargs)

        emit("status", message="Generating...")

        # Build chat prompt using tokenizer's chat template if available
        if hasattr(tokenizer, "apply_chat_template"):
            messages = [{"role": "user", "content": args.prompt}]
            prompt_text = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            prompt_text = args.prompt

        # Try new API with sampler first (mlx-lm >= 0.19), fallback to legacy temp param
        gen_kwargs = dict(
            prompt=prompt_text,
            max_tokens=args.max_tokens,
            verbose=False,
        )
        try:
            from mlx_lm.sample_utils import make_sampler
            sampler = make_sampler(temp=args.temp, top_p=args.top_p)
            gen_kwargs["sampler"] = sampler
        except (ImportError, TypeError):
            gen_kwargs["temp"] = args.temp
            gen_kwargs["top_p"] = args.top_p

        response = generate(model, tokenizer, **gen_kwargs)

        emit("response", text=response)
        emit("complete", tokens=len(response.split()))

    except Exception as e:
        emit("error", message=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
