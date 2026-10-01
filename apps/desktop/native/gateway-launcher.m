#import <Foundation/Foundation.h>
#import <ApplicationServices/ApplicationServices.h>
#include <fcntl.h>
#include <spawn.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
static volatile sig_atomic_t childPID = 0;
static volatile sig_atomic_t signalPID = 0;
static volatile sig_atomic_t restartPending = 0;
static volatile sig_atomic_t dumpPending = 0;

static void forwardSignal(int number) {
    if (number == SIGUSR1 || number == SIGUSR2) {
        // osascript has no user-signal handler. The timestamp wrapper announces
        // its PID only after installing its own gateway signal forwarders.
        if (signalPID > 0) kill(signalPID, number);
        else if (number == SIGUSR1) restartPending = 1;
        else dumpPending = 1;
    } else if (childPID > 0) kill(childPID, number);
}

static int run(char **command, BOOL gateway) {
    int channel[2] = {-1, -1};
    if (gateway) {
        if (pipe(channel)) return 126;
        fcntl(channel[0], F_SETFD, FD_CLOEXEC);
        char descriptor[20];
        snprintf(descriptor, sizeof(descriptor), "%d", channel[1]);
        setenv("HERMES_GATEWAY_SIGNAL_FD", descriptor, 1);
    }
    // Publish the child before a stop can arrive; keep launchd's process group.
    sigset_t blocked, previous;
    sigemptyset(&blocked);
    int signals[] = {SIGTERM, SIGINT, SIGHUP, SIGUSR1, SIGUSR2};
    for (size_t i = 0; i < sizeof(signals) / sizeof(signals[0]); i++) sigaddset(&blocked, signals[i]);
    if (sigprocmask(SIG_BLOCK, &blocked, &previous)) return 126;
    posix_spawnattr_t attributes;
    posix_spawnattr_init(&attributes);
    posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETSIGMASK);
    posix_spawnattr_setsigmask(&attributes, &previous);
    pid_t pid;
    int error = posix_spawn(&pid, command[0], NULL, &attributes, command, environ);
    posix_spawnattr_destroy(&attributes);
    if (!error) {
        childPID = pid;
        if (!gateway) signalPID = pid;
    }
    if (gateway) {
        close(channel[1]);
        unsetenv("HERMES_GATEWAY_SIGNAL_FD");
    }
    sigprocmask(SIG_SETMASK, &previous, NULL);
    if (error) {
        if (gateway) close(channel[0]);
        fprintf(stderr, "Hermes gateway: spawn failed: %s\n", strerror(error));
        return 126;
    }
    if (gateway) {
        char announced[20] = {0};
        ssize_t count;
        do { count = read(channel[0], announced, sizeof(announced) - 1); } while (count < 0 && errno == EINTR);
        close(channel[0]);
        if (count > 0) signalPID = (sig_atomic_t)strtol(announced, NULL, 10);
        if (signalPID > 0) {
            if (restartPending) kill(signalPID, SIGUSR1);
            if (dumpPending) kill(signalPID, SIGUSR2);
        }
    }
    int status;
    while (waitpid(pid, &status, 0) < 0) {
        if (errno != EINTR) return 126;
    }
    childPID = signalPID = 0;
    return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc == 2 && strcmp(argv[1], "--preflight") == 0) {
            // No pixels, Apple Event or permission dialog: only a TCC preflight.
            Boolean allowed = CGPreflightScreenCaptureAccess();
            printf("{\"pid\":%d,\"screen_allowed\":%s}\n", getpid(), allowed ? "true" : "false");
            return 0;
        }
        BOOL gateway = argc >= 3 && strcmp(argv[1], "--gateway") == 0;
        if (argc < 3 || (!gateway && strcmp(argv[1], "--") != 0) || argv[2][0] != '/') {
            fprintf(stderr, "Usage: HermesGateway --[gateway] /absolute/program [arguments]\n");
            return 64;
        }
        struct sigaction action = {0};
        action.sa_handler = forwardSignal;
        sigemptyset(&action.sa_mask);
        sigaction(SIGTERM, &action, NULL);
        sigaction(SIGINT, &action, NULL);
        sigaction(SIGHUP, &action, NULL);
        sigaction(SIGUSR1, &action, NULL);
        sigaction(SIGUSR2, &action, NULL);
        return run(&argv[2], gateway);
    }
}
