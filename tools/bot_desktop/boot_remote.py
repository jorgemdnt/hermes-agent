"""VPS-only user service: keep one Bot Desktop screen and its headed Chromium alive, no gateway."""
import subprocess
import time

from tools.bot_desktop import browser, runtime


def main() -> None:
    runtime.start()
    while True:
        if not runtime.status().running:
            raise RuntimeError("Bot Desktop launcher exited")
        launch = browser.dock_launch()
        if launch is None:
            raise RuntimeError("headed Chromium is not installed")
        if browser.running_instance_cdp_port(launch[1]) is None:
            subprocess.Popen(browser.dock_argv(*launch), env=runtime.desktop_env(),
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
        time.sleep(5)


if __name__ == "__main__":
    main()
