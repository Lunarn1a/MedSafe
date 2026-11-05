"""Start MedSafe from any folder on Windows, macOS, or Linux (Python 3.12/3.13)."""

from pathlib import Path
import argparse
import hashlib
import subprocess
import sys
import venv


ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "MedSafe" / "backend"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--check", action="store_true", help="Check setup without starting the website.")
    args = parser.parse_args()
    environment = BACKEND / ".venv"
    python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    try:
        if not python.exists():
            if sys.version_info[:2] not in ((3, 12), (3, 13)):
                parser.exit(1, "Install Python 3.13 or 3.12, then run this launcher with that Python version.\n")
            print("Creating MedSafe's local Python environment...", flush=True)
            venv.EnvBuilder(with_pip=True).create(environment)
        probe = subprocess.run([str(python), "-c", "import sys; print(sys.version_info[:2] in ((3,12),(3,13)))"], capture_output=True, text=True)
        if probe.returncode or probe.stdout.strip() != "True":
            parser.exit(1, "The .venv is incompatible or was copied from another computer. Rename or remove only MedSafe/backend/.venv, then rerun with Python 3.13 or 3.12.\n")
        requirements = BACKEND / "requirements.txt"
        checksum = hashlib.sha256(requirements.read_bytes()).hexdigest()
        marker = environment / ".medsafe-requirements.sha256"
        installed = marker.read_text().strip().lower() if marker.exists() else ""
        if installed != checksum:
            subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:", "-r", str(requirements)], check=True)
            marker.write_text(checksum, encoding="ascii")
        command = [str(python), str(BACKEND / "server.py"), "--port", str(args.port)]
        if args.check:
            command.append("--check")
        raise SystemExit(subprocess.call(command, cwd=ROOT))
    except KeyboardInterrupt:
        pass
    except (OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"MedSafe setup failed: {error}\nCheck your Python installation and internet connection, then try again.\n")


if __name__ == "__main__":
    main()
