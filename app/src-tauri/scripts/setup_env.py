#!/usr/bin/env python3
"""
Courtyard - Python environment setup script.
Called by Rust backend to verify and report environment status.
This script checks if mlx-lm is importable and reports versions.
"""
import json
import sys

def check_environment():
    result = {
        "python_version": sys.version,
        "python_path": sys.executable,
        "mlx_lm": False,
        "mlx_lm_version": None,
        "mlx": False,
        "mlx_version": None,
    }

    try:
        import mlx
        result["mlx"] = True
        result["mlx_version"] = mlx.__version__
    except ImportError:
        pass

    try:
        import mlx_lm
        result["mlx_lm"] = True
        result["mlx_lm_version"] = mlx_lm.__version__
    except ImportError:
        pass

    return result

if __name__ == "__main__":
    info = check_environment()
    print(json.dumps(info))
