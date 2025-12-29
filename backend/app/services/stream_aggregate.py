from __future__ import annotations

import json
from typing import Any, Dict, Optional


def collect_stream_chunks(stream_text: str) -> list[Dict[str, Any]]:
    if not stream_text:
        return []
    trimmed = stream_text.strip()
    if trimmed.startswith("["):
        try:
            parsed = json.loads(trimmed)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
    if trimmed.startswith("{"):
        try:
            parsed = json.loads(trimmed)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            return [parsed]

    chunks: list[Dict[str, Any]] = []
    for line in stream_text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            chunks.append(parsed)
        elif isinstance(parsed, list):
            chunks.extend([item for item in parsed if isinstance(item, dict)])
    return chunks


def aggregate_stream_chunks(chunks: list[Dict[str, Any]], protocol: str) -> Optional[Dict[str, Any]]:
    if not chunks:
        return None

    protocol = (protocol or "").lower().strip()
    if protocol not in {"openai", "anthropic", "gemini"}:
        protocol = _detect_protocol_from_chunks(chunks) or "openai"

    for chunk in reversed(chunks):
        response = chunk.get("response")
        if isinstance(response, dict):
            return response

    if protocol == "anthropic":
        payload = _aggregate_anthropic_chunks(chunks)
        if payload is not None:
            return payload
    elif protocol == "gemini":
        payload = _aggregate_gemini_chunks(chunks)
        if payload is not None:
            return payload

    payload = _aggregate_openai_chunks(chunks)
    if payload is not None:
        return payload
    return _aggregate_text_fallback(chunks)


def _detect_protocol_from_chunks(chunks: list[Dict[str, Any]]) -> Optional[str]:
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        chunk_type = chunk.get("type")
        if isinstance(chunk_type, str):
            if chunk_type.startswith("message_") or chunk_type.startswith("content_block_"):
                return "anthropic"
            if chunk_type.startswith("response."):
                return "openai"
        if "candidates" in chunk:
            return "gemini"
        if "choices" in chunk or "output_text" in chunk:
            return "openai"
    return None


def _coerce_index(value: Any) -> Optional[int]:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _aggregate_openai_chunks(chunks: list[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    base: Dict[str, Any] = {}
    choices: Dict[int, Dict[str, Any]] = {}
    usage = None
    has_choices = False
    has_delta = False
    has_text = False

    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        for key in ("id", "created", "model", "system_fingerprint", "service_tier"):
            if key in chunk and key not in base:
                base[key] = chunk[key]
        if "object" in chunk and "object" not in base:
            base["object"] = chunk["object"]
        if isinstance(chunk.get("usage"), dict):
            usage = chunk["usage"]

        choice_list = chunk.get("choices")
        if isinstance(choice_list, list):
            has_choices = True
            for choice in choice_list:
                if not isinstance(choice, dict):
                    continue
                idx = choice.get("index", 0)
                entry = choices.setdefault(idx, {"index": idx})
                if "finish_reason" in choice:
                    entry["finish_reason"] = choice["finish_reason"]
                if "logprobs" in choice:
                    entry["logprobs"] = choice["logprobs"]

                delta = choice.get("delta")
                if isinstance(delta, dict):
                    has_delta = True
                    message = entry.setdefault("message", {"role": "assistant"})
                    if delta.get("role"):
                        message["role"] = delta["role"]
                    if isinstance(delta.get("content"), str):
                        message["content"] = (message.get("content") or "") + delta["content"]
                    if isinstance(delta.get("refusal"), str):
                        message["refusal"] = (message.get("refusal") or "") + delta["refusal"]
                    _merge_function_call(message, delta.get("function_call"))
                    _merge_tool_calls(message, delta.get("tool_calls"))

                message = choice.get("message")
                if isinstance(message, dict):
                    entry["message"] = message

                if isinstance(choice.get("text"), str):
                    has_text = True
                    entry["text"] = (entry.get("text") or "") + choice["text"]

    output_text = _collect_output_text(chunks)
    if not has_choices and output_text is not None:
        payload: Dict[str, Any] = {}
        if output_text:
            payload["output_text"] = output_text
        if usage is not None:
            payload["usage"] = usage
        return payload or None

    if not choices:
        return None

    obj = base.get("object")
    if isinstance(obj, str) and obj.endswith(".chunk"):
        base["object"] = obj[: -len(".chunk")]
    elif "object" not in base:
        base["object"] = "chat.completion" if has_delta else "text_completion"

    ordered_choices = [choices[idx] for idx in sorted(choices.keys())]
    if has_delta or any("message" in entry for entry in ordered_choices):
        for entry in ordered_choices:
            if "message" not in entry:
                entry["message"] = {"role": "assistant", "content": entry.get("text", "")}
            elif "content" not in entry["message"] and "text" in entry:
                entry["message"]["content"] = entry["text"]

    payload = dict(base)
    payload["choices"] = ordered_choices
    if usage is not None:
        payload["usage"] = usage
    return payload


def _collect_output_text(chunks: list[Dict[str, Any]]) -> Optional[str]:
    text = ""
    found = False
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        if isinstance(chunk.get("output_text"), str):
            text += chunk["output_text"]
            found = True
        if chunk.get("type") == "response.output_text.delta" and isinstance(chunk.get("delta"), str):
            text += chunk["delta"]
            found = True
    return text if found else None


def _merge_function_call(message: Dict[str, Any], func_delta: Any) -> None:
    if not isinstance(func_delta, dict):
        return
    func_entry = message.setdefault("function_call", {})
    if func_delta.get("name"):
        func_entry["name"] = func_delta["name"]
    if func_delta.get("arguments") is not None:
        func_entry["arguments"] = (func_entry.get("arguments") or "") + str(
            func_delta["arguments"]
        )


def _merge_tool_calls(message: Dict[str, Any], tool_calls_delta: Any) -> None:
    if not isinstance(tool_calls_delta, list):
        return
    tool_calls = message.setdefault("tool_calls", [])
    for tool_call in tool_calls_delta:
        if not isinstance(tool_call, dict):
            continue
        tc_index = tool_call.get("index")
        if tc_index is None:
            tc_index = len(tool_calls)
        if not isinstance(tc_index, int) or tc_index < 0:
            tc_index = len(tool_calls)
        while len(tool_calls) <= tc_index:
            tool_calls.append({})
        entry = tool_calls[tc_index]
        if tool_call.get("id"):
            entry["id"] = tool_call["id"]
        if tool_call.get("type"):
            entry["type"] = tool_call["type"]
        func_delta = tool_call.get("function")
        if isinstance(func_delta, dict):
            func_entry = entry.setdefault("function", {})
            if func_delta.get("name"):
                func_entry["name"] = func_delta["name"]
            if func_delta.get("arguments") is not None:
                func_entry["arguments"] = (func_entry.get("arguments") or "") + str(
                    func_delta["arguments"]
                )


def _aggregate_anthropic_chunks(chunks: list[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    message: Optional[Dict[str, Any]] = None
    content_blocks: Dict[int, Dict[str, Any]] = {}
    usage = None

    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        chunk_type = chunk.get("type")
        if chunk_type == "message_start":
            msg = chunk.get("message")
            if isinstance(msg, dict):
                message = dict(msg)
        elif chunk_type == "content_block_start":
            idx = _coerce_index(chunk.get("index"))
            block = chunk.get("content_block")
            if idx is not None and isinstance(block, dict):
                content_blocks[idx] = dict(block)
        elif chunk_type == "content_block_delta":
            idx = _coerce_index(chunk.get("index"))
            delta = chunk.get("delta")
            if idx is None:
                continue
            block = content_blocks.setdefault(idx, {"type": "text", "text": ""})
            _apply_anthropic_delta(block, delta)
        elif chunk_type == "message_delta":
            delta = chunk.get("delta")
            if isinstance(delta, dict):
                if message is None:
                    message = {"type": "message", "role": "assistant", "content": []}
                for key in ("stop_reason", "stop_sequence"):
                    if key in delta:
                        message[key] = delta[key]
            if isinstance(chunk.get("usage"), dict):
                usage = chunk["usage"]
        elif isinstance(chunk.get("message"), dict) and message is None:
            message = dict(chunk["message"])

    if message is None and not content_blocks and usage is None:
        return None
    if message is None:
        message = {"type": "message", "role": "assistant", "content": []}

    if content_blocks:
        ordered_blocks = [content_blocks[idx] for idx in sorted(content_blocks.keys())]
        message["content"] = ordered_blocks
    elif "content" not in message:
        message["content"] = []

    if usage is not None and "usage" not in message:
        message["usage"] = usage
    return message


def _apply_anthropic_delta(block: Dict[str, Any], delta: Any) -> None:
    if not isinstance(delta, dict):
        return
    if isinstance(delta.get("text"), str):
        block["text"] = (block.get("text") or "") + delta["text"]
    if isinstance(delta.get("partial_json"), str):
        block["text"] = (block.get("text") or "") + delta["partial_json"]


def _aggregate_gemini_chunks(chunks: list[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    candidates: Dict[int, Dict[str, Any]] = {}
    usage = None
    prompt_feedback = None
    model_version = None

    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        if isinstance(chunk.get("usageMetadata"), dict):
            usage = chunk["usageMetadata"]
        if isinstance(chunk.get("promptFeedback"), dict):
            prompt_feedback = chunk["promptFeedback"]
        if isinstance(chunk.get("modelVersion"), str):
            model_version = chunk["modelVersion"]

        cand_list = chunk.get("candidates")
        if not isinstance(cand_list, list):
            continue
        for i, cand in enumerate(cand_list):
            if not isinstance(cand, dict):
                continue
            idx = cand.get("index", i)
            entry = candidates.setdefault(idx, {"index": idx})
            for key in (
                "finishReason",
                "safetyRatings",
                "citationMetadata",
                "groundingMetadata",
                "avgLogprobs",
            ):
                if key in cand:
                    entry[key] = cand[key]
            content = cand.get("content")
            if isinstance(content, dict):
                role = content.get("role")
                entry_content = entry.setdefault("content", {"role": role or "model", "parts": []})
                if role and not entry_content.get("role"):
                    entry_content["role"] = role
                parts = content.get("parts")
                if isinstance(parts, list):
                    for part in parts:
                        if not isinstance(part, dict):
                            continue
                        if isinstance(part.get("text"), str):
                            entry["_text"] = (entry.get("_text") or "") + part["text"]

    if not candidates:
        return None

    ordered_candidates = []
    for idx in sorted(candidates.keys()):
        entry = candidates[idx]
        text = entry.pop("_text", "")
        if "content" not in entry:
            entry["content"] = {"role": "model", "parts": []}
        content = entry["content"]
        if text:
            content["parts"] = [{"text": text}]
        elif "parts" not in content:
            content["parts"] = []
        ordered_candidates.append(entry)

    payload: Dict[str, Any] = {"candidates": ordered_candidates}
    if usage is not None:
        payload["usageMetadata"] = usage
    if prompt_feedback is not None:
        payload["promptFeedback"] = prompt_feedback
    if model_version is not None:
        payload["modelVersion"] = model_version
    return payload


def _extract_text_from_chunk(chunk: Dict[str, Any]) -> str:
    text = ""
    choices = chunk.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            delta = choice.get("delta")
            if isinstance(delta, dict) and isinstance(delta.get("content"), str):
                text += delta["content"]
            message = choice.get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                text += message["content"]
            if isinstance(choice.get("text"), str):
                text += choice["text"]

    if isinstance(chunk.get("output_text"), str):
        text += chunk["output_text"]
    if chunk.get("type") == "response.output_text.delta" and isinstance(chunk.get("delta"), str):
        text += chunk["delta"]
    if chunk.get("type") == "content_block_delta":
        delta = chunk.get("delta")
        if isinstance(delta, dict) and isinstance(delta.get("text"), str):
            text += delta["text"]
    candidates = chunk.get("candidates")
    if isinstance(candidates, list):
        for cand in candidates:
            if not isinstance(cand, dict):
                continue
            content = cand.get("content")
            if isinstance(content, dict):
                parts = content.get("parts")
                if isinstance(parts, list):
                    for part in parts:
                        if not isinstance(part, dict):
                            continue
                        if isinstance(part.get("text"), str):
                            text += part["text"]
    return text


def _aggregate_text_fallback(chunks: list[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    text = ""
    usage = None
    usage_meta = None
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        text += _extract_text_from_chunk(chunk)
        if isinstance(chunk.get("usage"), dict):
            usage = chunk["usage"]
        if isinstance(chunk.get("usageMetadata"), dict):
            usage_meta = chunk["usageMetadata"]

    if not text and usage is None and usage_meta is None:
        return None

    payload: Dict[str, Any] = {}
    if text:
        payload["text"] = text
    if usage is not None:
        payload["usage"] = usage
    if usage_meta is not None:
        payload["usageMetadata"] = usage_meta
    return payload
