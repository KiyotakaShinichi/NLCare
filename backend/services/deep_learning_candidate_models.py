"""The four temporal architectures the benchmark compares.

A sequence MLP, a temporal CNN, a bidirectional GRU, and a small transformer,
plus the factory table the benchmark iterates over. Split out of
``deep_learning_candidate_benchmark`` so an architecture can be read, tested,
or swapped without touching the experiment harness.

Weights are initialised when a factory is *called*, from the global torch
generator the harness seeds, and the harness calls them in the same order as
before the split - so initialisation is unchanged.
"""
from __future__ import annotations


import torch
from torch import nn


def _model_factories(*, input_dim: int, hidden_size: int, seq_len: int):
    return {
        "sequence_mlp": lambda: SequenceMLP(input_dim=input_dim, hidden_size=hidden_size, seq_len=seq_len),
        "temporal_cnn": lambda: TemporalCNN(input_dim=input_dim, hidden_size=hidden_size),
        "bidirectional_gru": lambda: BiGRU(input_dim=input_dim, hidden_size=hidden_size),
        "tiny_transformer": lambda: TinyTransformer(input_dim=input_dim, hidden_size=hidden_size, seq_len=seq_len),
    }


class SequenceMLP(nn.Module):
    def __init__(self, *, input_dim: int, hidden_size: int, seq_len: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Flatten(),
            nn.Linear(input_dim * seq_len, hidden_size * 2),
            nn.ReLU(),
            nn.Dropout(0.15),
            nn.Linear(hidden_size * 2, hidden_size),
            nn.ReLU(),
        )
        self.class_head = nn.Linear(hidden_size, 1)
        self.reg_head = nn.Sequential(nn.Linear(hidden_size, 1), nn.Sigmoid())

    def forward(self, x):
        z = self.net(x)
        return self.class_head(z), self.reg_head(z)


class TemporalCNN(nn.Module):
    def __init__(self, *, input_dim: int, hidden_size: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(input_dim, hidden_size, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv1d(hidden_size, hidden_size, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),
        )
        self.class_head = nn.Linear(hidden_size, 1)
        self.reg_head = nn.Sequential(nn.Linear(hidden_size, 1), nn.Sigmoid())

    def forward(self, x):
        z = self.net(x.transpose(1, 2)).squeeze(-1)
        return self.class_head(z), self.reg_head(z)


class BiGRU(nn.Module):
    def __init__(self, *, input_dim: int, hidden_size: int):
        super().__init__()
        self.gru = nn.GRU(input_dim, hidden_size, batch_first=True, bidirectional=True)
        self.dropout = nn.Dropout(0.15)
        self.class_head = nn.Linear(hidden_size * 2, 1)
        self.reg_head = nn.Sequential(nn.Linear(hidden_size * 2, 1), nn.Sigmoid())

    def forward(self, x):
        _, hidden = self.gru(x)
        z = torch.cat([hidden[-2], hidden[-1]], dim=1)
        z = self.dropout(z)
        return self.class_head(z), self.reg_head(z)


class TinyTransformer(nn.Module):
    def __init__(self, *, input_dim: int, hidden_size: int, seq_len: int):
        super().__init__()
        self.proj = nn.Linear(input_dim, hidden_size)
        self.pos = nn.Parameter(torch.zeros(1, seq_len, hidden_size))
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=hidden_size,
            nhead=4,
            dim_feedforward=hidden_size * 2,
            dropout=0.1,
            batch_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=1)
        self.class_head = nn.Linear(hidden_size, 1)
        self.reg_head = nn.Sequential(nn.Linear(hidden_size, 1), nn.Sigmoid())

    def forward(self, x):
        z = self.proj(x) + self.pos
        z = self.encoder(z).mean(dim=1)
        return self.class_head(z), self.reg_head(z)
