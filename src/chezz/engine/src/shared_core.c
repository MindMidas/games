#include "chezz.h"

const char *square_lookup[TOTAL_SQUARES] = {
    "A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1",
    "A2", "B2", "C2", "D2", "E2", "F2", "G2", "H2",
    "A3", "B3", "C3", "D3", "E3", "F3", "G3", "H3",
    "A4", "B4", "C4", "D4", "E4", "F4", "G4", "H4",
    "A5", "B5", "C5", "D5", "E5", "F5", "G5", "H5",
    "A6", "B6", "C6", "D6", "E6", "F6", "G6", "H6",
    "A7", "B7", "C7", "D7", "E7", "F7", "G7", "H7",
    "A8", "B8", "C8", "D8", "E8", "F8", "G8", "H8"
};

const Bitboard col_masks[8] = {
    0x0101010101010101ULL,
    0x0202020202020202ULL,
    0x0404040404040404ULL,
    0x0808080808080808ULL,
    0x1010101010101010ULL,
    0x2020202020202020ULL,
    0x4040404040404040ULL,
    0x8080808080808080ULL
};

const Bitboard row_masks[8] = {
    0x00000000000000FFULL,
    0x000000000000FF00ULL,
    0x0000000000FF0000ULL,
    0x00000000FF000000ULL,
    0x000000FF00000000ULL,
    0x0000FF0000000000ULL,
    0x00FF000000000000ULL,
    0xFF00000000000000ULL
};

const char *piece_lookup[TOTAL_TYPES] = {
    "wP", "bP",
    "wN", "bN",
    "wB", "bB",
    "wR", "bR",
    "wQ", "bQ",
    "wK", "bK",
    "wZ", "bZ",
    "wF", "bF",
    "wC", "bC"
};

int square_to_index(const char *square) {
    int column = square[0] - 'a';
    int row = (square[1] - '1');
    return row * 8 + column;
}

int get_piece_index(const char *piece) {
    for (int i = 0; i < TOTAL_TYPES; i++) {
        if (strcmp(piece, piece_lookup[i]) == 0) {
            return i;
        }
    }
    return INVALID_PIECE;
}

