"""Executable contract for the default offline test transport boundary."""

from __future__ import annotations

import os
import socket

import pytest

from conftest import NetworkEgressBlocked, network_block_required


def test_canonical_offline_mode_and_provider_credentials() -> None:
    assert os.environ["NLCARE_TEST_OFFLINE"] == "true"
    assert os.environ["HF_HUB_OFFLINE"] == "1"
    assert os.environ["TRANSFORMERS_OFFLINE"] == "1"
    for name in ("GROQ_API_KEY", "OPENAI_API_KEY", "PINECONE_API_KEY", "N8N_API_KEY"):
        assert name not in os.environ


def test_external_socket_attempt_fails_with_target() -> None:
    with pytest.raises(NetworkEgressBlocked, match="example.com"):
        socket.create_connection(("example.com", 443), timeout=0.01)


def test_external_dns_attempt_fails_with_target() -> None:
    with pytest.raises(NetworkEgressBlocked, match="example.com"):
        socket.getaddrinfo("example.com", 443)


def test_loopback_dns_and_socket_remain_available() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    try:
        client = socket.create_connection(listener.getsockname(), timeout=1)
        server, _ = listener.accept()
        client.close()
        server.close()
    finally:
        listener.close()


def test_requires_network_marker_explicitly_opts_out() -> None:
    class Node:
        def get_closest_marker(self, name: str):
            return object() if name == "requires_network" else None

    assert network_block_required(Node()) is False  # type: ignore[arg-type]


def test_suite_defaults_are_in_place_before_any_backend_import() -> None:
    """A fixture would be too late: RAG_FORCE_SPARSE is read at module import."""
    from conftest import _SUITE_DEFAULTS

    for name in _SUITE_DEFAULTS:
        assert name in os.environ, f"{name} is unset for the default suite"


def test_the_default_suite_constructs_no_retrieval_model() -> None:
    """Local and CI runs must exercise the same retrieval code.

    With dense retrieval active, the first index build or query loads
    sentence-transformers/all-MiniLM-L6-v2, which no provisioning step fetches
    and which is therefore downloaded from the hub on first use. The default
    suite runs sparse, so no embedding model is ever constructed.
    """
    if os.environ.get("RAG_FORCE_SPARSE") != "true":
        pytest.skip("dense retrieval was requested explicitly for this run")

    from backend.services import rag_vector_index

    assert rag_vector_index._DENSE_AVAILABLE is False
    assert rag_vector_index._current_backend_name() == "local_sparse_tfidf_bm25_index"
    assert rag_vector_index._get_encoder() is None
