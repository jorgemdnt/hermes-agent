from tools.bot_live_delivery import live_delivery_action, resolve_delivery_mode


def test_idle_bot_message_starts_a_turn():
    assert live_delivery_action(False, "steer") == "turn"
    assert live_delivery_action(False, "interrupt") == "turn"
    assert live_delivery_action(False, "queue") == "turn"


def test_busy_bot_message_uses_the_same_three_verbs_as_typing():
    assert live_delivery_action(True, "queue") == "queue"
    assert live_delivery_action(True, "steer") == "steer"
    assert live_delivery_action(True, "interrupt") == "interrupt"


def test_omitted_mode_falls_back_to_the_thread_setting():
    assert resolve_delivery_mode(None, "queue") == "queue"
    assert resolve_delivery_mode("", "steer") == "steer"
    assert resolve_delivery_mode("nope", "interrupt") == "interrupt"
