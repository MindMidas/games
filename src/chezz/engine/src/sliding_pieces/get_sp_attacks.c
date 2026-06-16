#include "sp.h"


/*
 * Fetches bishop attack bitboard for a blocker config using magic numbers.
 * square: Square index (0-63) of the bishop.
 * blockers: Bitboard of blocking pieces.
 * Returns bitboard with bits set (for bishop attack squares).
 */
Bitboard bishop_attacks(int square, Bitboard blockers) {
    
    // compute magic index for lookup
    Bitboard index = (blockers & bishop_magics[square].mask) * bishop_magics[square].magic_number;

    // shift and MASK to prevent out-of-bounds access
    index = (index >> (TOTAL_SQUARES - bishop_magics[square].relevant_bits)) & ((1ULL << bishop_magics[square].relevant_bits) - 1);

    // return attack bitboard from bishop magic table
    return bishop_magics[square].attack_table[index];

}


/*
 * Fetches rook attack bitboard for a blocker config using magic numbers.
 * square: Square index (0-63) of the rook.
 * blockers: Bitboard of blocking pieces.
 * Returns bitboard with bits set (for rook attack squares).
 */
Bitboard rook_attacks(int square, Bitboard blockers) {

    // compute magic index for lookup
    Bitboard index = (blockers & rook_magics[square].mask) * rook_magics[square].magic_number;

    // shift and MASK to prevent out-of-bounds access
    index = (index >> (TOTAL_SQUARES - rook_magics[square].relevant_bits)) & ((1ULL << rook_magics[square].relevant_bits) - 1);

    // return attack bitboard from rook magic table
    return rook_magics[square].attack_table[index];

}


/*
 * Fetches queen attack bitboard for a blocker congi using magic numbers.
 * square: Square index (0-63) of the queen.
 * blockers: Bitboard of blocking pieces.
 * Returns bitboard with bits set for (queen attack squares (bishop + rook moves)).
 */
Bitboard queen_attacks(int square, Bitboard blockers) {
    return bishop_attacks(square, blockers) | rook_attacks(square, blockers);
}
