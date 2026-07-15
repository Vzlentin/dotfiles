"""Shared test infrastructure helpers (not fixtures; import directly)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType


def load_script_module(path: Path) -> ModuleType:
    """Import a standalone script (outside any package) as a module.

    Used for the skill scripts that tests exercise directly, e.g.
    ``skills/go/scripts/``. The module is registered in ``sys.modules`` under
    its stem so dataclasses and pickling resolve it.
    """
    name = path.stem
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
