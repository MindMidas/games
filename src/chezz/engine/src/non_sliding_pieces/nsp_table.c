#include "nsp.h"

Bitboard nsp_table[TOTAL_TYPES][TOTAL_SQUARES] = {
    { // Type wP
        0x300ULL,         0x700ULL,         0xe00ULL,         0x1c00ULL,         0x3800ULL,         0x7000ULL,         0xe000ULL,         0xc000ULL, 
        0x30000ULL,         0x70000ULL,         0xe0000ULL,         0x1c0000ULL,         0x380000ULL,         0x700000ULL,         0xe00000ULL,         0xc00000ULL, 
        0x3000000ULL,         0x7000000ULL,         0xe000000ULL,         0x1c000000ULL,         0x38000000ULL,         0x70000000ULL,         0xe0000000ULL,         0xc0000000ULL, 
        0x300000000ULL,         0x700000000ULL,         0xe00000000ULL,         0x1c00000000ULL,         0x3800000000ULL,         0x7000000000ULL,         0xe000000000ULL,         0xc000000000ULL, 
        0x30000000000ULL,         0x70000000000ULL,         0xe0000000000ULL,         0x1c0000000000ULL,         0x380000000000ULL,         0x700000000000ULL,         0xe00000000000ULL,         0xc00000000000ULL, 
        0x3000000000000ULL,         0x7000000000000ULL,         0xe000000000000ULL,         0x1c000000000000ULL,         0x38000000000000ULL,         0x70000000000000ULL,         0xe0000000000000ULL,         0xc0000000000000ULL, 
        0x300000000000000ULL,         0x700000000000000ULL,         0xe00000000000000ULL,         0x1c00000000000000ULL,         0x3800000000000000ULL,         0x7000000000000000ULL,         0xe000000000000000ULL,         0xc000000000000000ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL
    },
    { // Type bP
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0x3ULL,         0x7ULL,         0xeULL,         0x1cULL,         0x38ULL,         0x70ULL,         0xe0ULL,         0xc0ULL, 
        0x300ULL,         0x700ULL,         0xe00ULL,         0x1c00ULL,         0x3800ULL,         0x7000ULL,         0xe000ULL,         0xc000ULL, 
        0x30000ULL,         0x70000ULL,         0xe0000ULL,         0x1c0000ULL,         0x380000ULL,         0x700000ULL,         0xe00000ULL,         0xc00000ULL, 
        0x3000000ULL,         0x7000000ULL,         0xe000000ULL,         0x1c000000ULL,         0x38000000ULL,         0x70000000ULL,         0xe0000000ULL,         0xc0000000ULL, 
        0x300000000ULL,         0x700000000ULL,         0xe00000000ULL,         0x1c00000000ULL,         0x3800000000ULL,         0x7000000000ULL,         0xe000000000ULL,         0xc000000000ULL, 
        0x30000000000ULL,         0x70000000000ULL,         0xe0000000000ULL,         0x1c0000000000ULL,         0x380000000000ULL,         0x700000000000ULL,         0xe00000000000ULL,         0xc00000000000ULL, 
        0x3000000000000ULL,         0x7000000000000ULL,         0xe000000000000ULL,         0x1c000000000000ULL,         0x38000000000000ULL,         0x70000000000000ULL,         0xe0000000000000ULL,         0xc0000000000000ULL
    },
    { // Type wN
        0x20400ULL,         0x50800ULL,         0xa1100ULL,         0x142200ULL,         0x284400ULL,         0x508800ULL,         0xa01000ULL,         0x402000ULL, 
        0x2040004ULL,         0x5080008ULL,         0xa110011ULL,         0x14220022ULL,         0x28440044ULL,         0x50880088ULL,         0xa0100010ULL,         0x40200020ULL, 
        0x204000402ULL,         0x508000805ULL,         0xa1100110aULL,         0x1422002214ULL,         0x2844004428ULL,         0x5088008850ULL,         0xa0100010a0ULL,         0x4020002040ULL, 
        0x20400040200ULL,         0x50800080500ULL,         0xa1100110a00ULL,         0x142200221400ULL,         0x284400442800ULL,         0x508800885000ULL,         0xa0100010a000ULL,         0x402000204000ULL, 
        0x2040004020000ULL,         0x5080008050000ULL,         0xa1100110a0000ULL,         0x14220022140000ULL,         0x28440044280000ULL,         0x50880088500000ULL,         0xa0100010a00000ULL,         0x40200020400000ULL, 
        0x204000402000000ULL,         0x508000805000000ULL,         0xa1100110a000000ULL,         0x1422002214000000ULL,         0x2844004428000000ULL,         0x5088008850000000ULL,         0xa0100010a0000000ULL,         0x4020002040000000ULL, 
        0x400040200000000ULL,         0x800080500000000ULL,         0x1100110a00000000ULL,         0x2200221400000000ULL,         0x4400442800000000ULL,         0x8800885000000000ULL,         0x100010a000000000ULL,         0x2000204000000000ULL, 
        0x4020000000000ULL,         0x8050000000000ULL,         0x110a0000000000ULL,         0x22140000000000ULL,         0x44280000000000ULL,         0x88500000000000ULL,         0x10a00000000000ULL,         0x20400000000000ULL
    },
    { // Type bN
        0x20400ULL,         0x50800ULL,         0xa1100ULL,         0x142200ULL,         0x284400ULL,         0x508800ULL,         0xa01000ULL,         0x402000ULL, 
        0x2040004ULL,         0x5080008ULL,         0xa110011ULL,         0x14220022ULL,         0x28440044ULL,         0x50880088ULL,         0xa0100010ULL,         0x40200020ULL, 
        0x204000402ULL,         0x508000805ULL,         0xa1100110aULL,         0x1422002214ULL,         0x2844004428ULL,         0x5088008850ULL,         0xa0100010a0ULL,         0x4020002040ULL, 
        0x20400040200ULL,         0x50800080500ULL,         0xa1100110a00ULL,         0x142200221400ULL,         0x284400442800ULL,         0x508800885000ULL,         0xa0100010a000ULL,         0x402000204000ULL, 
        0x2040004020000ULL,         0x5080008050000ULL,         0xa1100110a0000ULL,         0x14220022140000ULL,         0x28440044280000ULL,         0x50880088500000ULL,         0xa0100010a00000ULL,         0x40200020400000ULL, 
        0x204000402000000ULL,         0x508000805000000ULL,         0xa1100110a000000ULL,         0x1422002214000000ULL,         0x2844004428000000ULL,         0x5088008850000000ULL,         0xa0100010a0000000ULL,         0x4020002040000000ULL, 
        0x400040200000000ULL,         0x800080500000000ULL,         0x1100110a00000000ULL,         0x2200221400000000ULL,         0x4400442800000000ULL,         0x8800885000000000ULL,         0x100010a000000000ULL,         0x2000204000000000ULL, 
        0x4020000000000ULL,         0x8050000000000ULL,         0x110a0000000000ULL,         0x22140000000000ULL,         0x44280000000000ULL,         0x88500000000000ULL,         0x10a00000000000ULL,         0x20400000000000ULL
    },
    { // Type wB
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL
    },
    { // Type bB
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL
    },
    { // Type wR
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL
    },
    { // Type bR
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL
    },
    { // Type wQ
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL
    },
    { // Type bQ
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL, 
        0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL,         0ULL
    },
    { // Type wK
        0x302ULL,         0x705ULL,         0xe0aULL,         0x1c14ULL,         0x3828ULL,         0x7050ULL,         0xe0a0ULL,         0xc040ULL, 
        0x30203ULL,         0x70507ULL,         0xe0a0eULL,         0x1c141cULL,         0x382838ULL,         0x705070ULL,         0xe0a0e0ULL,         0xc040c0ULL, 
        0x3020300ULL,         0x7050700ULL,         0xe0a0e00ULL,         0x1c141c00ULL,         0x38283800ULL,         0x70507000ULL,         0xe0a0e000ULL,         0xc040c000ULL, 
        0x302030000ULL,         0x705070000ULL,         0xe0a0e0000ULL,         0x1c141c0000ULL,         0x3828380000ULL,         0x7050700000ULL,         0xe0a0e00000ULL,         0xc040c00000ULL, 
        0x30203000000ULL,         0x70507000000ULL,         0xe0a0e000000ULL,         0x1c141c000000ULL,         0x382838000000ULL,         0x705070000000ULL,         0xe0a0e0000000ULL,         0xc040c0000000ULL, 
        0x3020300000000ULL,         0x7050700000000ULL,         0xe0a0e00000000ULL,         0x1c141c00000000ULL,         0x38283800000000ULL,         0x70507000000000ULL,         0xe0a0e000000000ULL,         0xc040c000000000ULL, 
        0x302030000000000ULL,         0x705070000000000ULL,         0xe0a0e0000000000ULL,         0x1c141c0000000000ULL,         0x3828380000000000ULL,         0x7050700000000000ULL,         0xe0a0e00000000000ULL,         0xc040c00000000000ULL, 
        0x203000000000000ULL,         0x507000000000000ULL,         0xa0e000000000000ULL,         0x141c000000000000ULL,         0x2838000000000000ULL,         0x5070000000000000ULL,         0xa0e0000000000000ULL,         0x40c0000000000000ULL
    },
    { // Type bK
        0x302ULL,         0x705ULL,         0xe0aULL,         0x1c14ULL,         0x3828ULL,         0x7050ULL,         0xe0a0ULL,         0xc040ULL, 
        0x30203ULL,         0x70507ULL,         0xe0a0eULL,         0x1c141cULL,         0x382838ULL,         0x705070ULL,         0xe0a0e0ULL,         0xc040c0ULL, 
        0x3020300ULL,         0x7050700ULL,         0xe0a0e00ULL,         0x1c141c00ULL,         0x38283800ULL,         0x70507000ULL,         0xe0a0e000ULL,         0xc040c000ULL, 
        0x302030000ULL,         0x705070000ULL,         0xe0a0e0000ULL,         0x1c141c0000ULL,         0x3828380000ULL,         0x7050700000ULL,         0xe0a0e00000ULL,         0xc040c00000ULL, 
        0x30203000000ULL,         0x70507000000ULL,         0xe0a0e000000ULL,         0x1c141c000000ULL,         0x382838000000ULL,         0x705070000000ULL,         0xe0a0e0000000ULL,         0xc040c0000000ULL, 
        0x3020300000000ULL,         0x7050700000000ULL,         0xe0a0e00000000ULL,         0x1c141c00000000ULL,         0x38283800000000ULL,         0x70507000000000ULL,         0xe0a0e000000000ULL,         0xc040c000000000ULL, 
        0x302030000000000ULL,         0x705070000000000ULL,         0xe0a0e0000000000ULL,         0x1c141c0000000000ULL,         0x3828380000000000ULL,         0x7050700000000000ULL,         0xe0a0e00000000000ULL,         0xc040c00000000000ULL, 
        0x203000000000000ULL,         0x507000000000000ULL,         0xa0e000000000000ULL,         0x141c000000000000ULL,         0x2838000000000000ULL,         0x5070000000000000ULL,         0xa0e0000000000000ULL,         0x40c0000000000000ULL
    },
    { // Type wZ
        0x102ULL,         0x205ULL,         0x40aULL,         0x814ULL,         0x1028ULL,         0x2050ULL,         0x40a0ULL,         0x8040ULL, 
        0x10201ULL,         0x20502ULL,         0x40a04ULL,         0x81408ULL,         0x102810ULL,         0x205020ULL,         0x40a040ULL,         0x804080ULL, 
        0x1020100ULL,         0x2050200ULL,         0x40a0400ULL,         0x8140800ULL,         0x10281000ULL,         0x20502000ULL,         0x40a04000ULL,         0x80408000ULL, 
        0x102010000ULL,         0x205020000ULL,         0x40a040000ULL,         0x814080000ULL,         0x1028100000ULL,         0x2050200000ULL,         0x40a0400000ULL,         0x8040800000ULL, 
        0x10201000000ULL,         0x20502000000ULL,         0x40a04000000ULL,         0x81408000000ULL,         0x102810000000ULL,         0x205020000000ULL,         0x40a040000000ULL,         0x804080000000ULL, 
        0x1020100000000ULL,         0x2050200000000ULL,         0x40a0400000000ULL,         0x8140800000000ULL,         0x10281000000000ULL,         0x20502000000000ULL,         0x40a04000000000ULL,         0x80408000000000ULL, 
        0x102010000000000ULL,         0x205020000000000ULL,         0x40a040000000000ULL,         0x814080000000000ULL,         0x1028100000000000ULL,         0x2050200000000000ULL,         0x40a0400000000000ULL,         0x8040800000000000ULL, 
        0x201000000000000ULL,         0x502000000000000ULL,         0xa04000000000000ULL,         0x1408000000000000ULL,         0x2810000000000000ULL,         0x5020000000000000ULL,         0xa040000000000000ULL,         0x4080000000000000ULL
    },
    { // Type bZ
        0x102ULL,         0x205ULL,         0x40aULL,         0x814ULL,         0x1028ULL,         0x2050ULL,         0x40a0ULL,         0x8040ULL, 
        0x10201ULL,         0x20502ULL,         0x40a04ULL,         0x81408ULL,         0x102810ULL,         0x205020ULL,         0x40a040ULL,         0x804080ULL, 
        0x1020100ULL,         0x2050200ULL,         0x40a0400ULL,         0x8140800ULL,         0x10281000ULL,         0x20502000ULL,         0x40a04000ULL,         0x80408000ULL, 
        0x102010000ULL,         0x205020000ULL,         0x40a040000ULL,         0x814080000ULL,         0x1028100000ULL,         0x2050200000ULL,         0x40a0400000ULL,         0x8040800000ULL, 
        0x10201000000ULL,         0x20502000000ULL,         0x40a04000000ULL,         0x81408000000ULL,         0x102810000000ULL,         0x205020000000ULL,         0x40a040000000ULL,         0x804080000000ULL, 
        0x1020100000000ULL,         0x2050200000000ULL,         0x40a0400000000ULL,         0x8140800000000ULL,         0x10281000000000ULL,         0x20502000000000ULL,         0x40a04000000000ULL,         0x80408000000000ULL, 
        0x102010000000000ULL,         0x205020000000000ULL,         0x40a040000000000ULL,         0x814080000000000ULL,         0x1028100000000000ULL,         0x2050200000000000ULL,         0x40a0400000000000ULL,         0x8040800000000000ULL, 
        0x201000000000000ULL,         0x502000000000000ULL,         0xa04000000000000ULL,         0x1408000000000000ULL,         0x2810000000000000ULL,         0x5020000000000000ULL,         0xa040000000000000ULL,         0x4080000000000000ULL
    },
    { // Type wF
        0x302ULL,         0x705ULL,         0xe0aULL,         0x1c14ULL,         0x3828ULL,         0x7050ULL,         0xe0a0ULL,         0xc040ULL, 
        0x30203ULL,         0x70507ULL,         0xe0a0eULL,         0x1c141cULL,         0x382838ULL,         0x705070ULL,         0xe0a0e0ULL,         0xc040c0ULL, 
        0x3020300ULL,         0x7050700ULL,         0xe0a0e00ULL,         0x1c141c00ULL,         0x38283800ULL,         0x70507000ULL,         0xe0a0e000ULL,         0xc040c000ULL, 
        0x302030000ULL,         0x705070000ULL,         0xe0a0e0000ULL,         0x1c141c0000ULL,         0x3828380000ULL,         0x7050700000ULL,         0xe0a0e00000ULL,         0xc040c00000ULL, 
        0x30203000000ULL,         0x70507000000ULL,         0xe0a0e000000ULL,         0x1c141c000000ULL,         0x382838000000ULL,         0x705070000000ULL,         0xe0a0e0000000ULL,         0xc040c0000000ULL, 
        0x3020300000000ULL,         0x7050700000000ULL,         0xe0a0e00000000ULL,         0x1c141c00000000ULL,         0x38283800000000ULL,         0x70507000000000ULL,         0xe0a0e000000000ULL,         0xc040c000000000ULL, 
        0x302030000000000ULL,         0x705070000000000ULL,         0xe0a0e0000000000ULL,         0x1c141c0000000000ULL,         0x3828380000000000ULL,         0x7050700000000000ULL,         0xe0a0e00000000000ULL,         0xc040c00000000000ULL, 
        0x203000000000000ULL,         0x507000000000000ULL,         0xa0e000000000000ULL,         0x141c000000000000ULL,         0x2838000000000000ULL,         0x5070000000000000ULL,         0xa0e0000000000000ULL,         0x40c0000000000000ULL
    },
    { // Type bF
        0x302ULL,         0x705ULL,         0xe0aULL,         0x1c14ULL,         0x3828ULL,         0x7050ULL,         0xe0a0ULL,         0xc040ULL, 
        0x30203ULL,         0x70507ULL,         0xe0a0eULL,         0x1c141cULL,         0x382838ULL,         0x705070ULL,         0xe0a0e0ULL,         0xc040c0ULL, 
        0x3020300ULL,         0x7050700ULL,         0xe0a0e00ULL,         0x1c141c00ULL,         0x38283800ULL,         0x70507000ULL,         0xe0a0e000ULL,         0xc040c000ULL, 
        0x302030000ULL,         0x705070000ULL,         0xe0a0e0000ULL,         0x1c141c0000ULL,         0x3828380000ULL,         0x7050700000ULL,         0xe0a0e00000ULL,         0xc040c00000ULL, 
        0x30203000000ULL,         0x70507000000ULL,         0xe0a0e000000ULL,         0x1c141c000000ULL,         0x382838000000ULL,         0x705070000000ULL,         0xe0a0e0000000ULL,         0xc040c0000000ULL, 
        0x3020300000000ULL,         0x7050700000000ULL,         0xe0a0e00000000ULL,         0x1c141c00000000ULL,         0x38283800000000ULL,         0x70507000000000ULL,         0xe0a0e000000000ULL,         0xc040c000000000ULL, 
        0x302030000000000ULL,         0x705070000000000ULL,         0xe0a0e0000000000ULL,         0x1c141c0000000000ULL,         0x3828380000000000ULL,         0x7050700000000000ULL,         0xe0a0e00000000000ULL,         0xc040c00000000000ULL, 
        0x203000000000000ULL,         0x507000000000000ULL,         0xa0e000000000000ULL,         0x141c000000000000ULL,         0x2838000000000000ULL,         0x5070000000000000ULL,         0xa0e0000000000000ULL,         0x40c0000000000000ULL
    },
    { // Type wC
        0x102ULL,         0x205ULL,         0x40aULL,         0x814ULL,         0x1028ULL,         0x2050ULL,         0x40a0ULL,         0x8040ULL, 
        0x10201ULL,         0x20502ULL,         0x40a04ULL,         0x81408ULL,         0x102810ULL,         0x205020ULL,         0x40a040ULL,         0x804080ULL, 
        0x1020100ULL,         0x2050200ULL,         0x40a0400ULL,         0x8140800ULL,         0x10281000ULL,         0x20502000ULL,         0x40a04000ULL,         0x80408000ULL, 
        0x102010000ULL,         0x205020000ULL,         0x40a040000ULL,         0x814080000ULL,         0x1028100000ULL,         0x2050200000ULL,         0x40a0400000ULL,         0x8040800000ULL, 
        0x10201000000ULL,         0x20502000000ULL,         0x40a04000000ULL,         0x81408000000ULL,         0x102810000000ULL,         0x205020000000ULL,         0x40a040000000ULL,         0x804080000000ULL, 
        0x1020100000000ULL,         0x2050200000000ULL,         0x40a0400000000ULL,         0x8140800000000ULL,         0x10281000000000ULL,         0x20502000000000ULL,         0x40a04000000000ULL,         0x80408000000000ULL, 
        0x102010000000000ULL,         0x205020000000000ULL,         0x40a040000000000ULL,         0x814080000000000ULL,         0x1028100000000000ULL,         0x2050200000000000ULL,         0x40a0400000000000ULL,         0x8040800000000000ULL, 
        0x201000000000000ULL,         0x502000000000000ULL,         0xa04000000000000ULL,         0x1408000000000000ULL,         0x2810000000000000ULL,         0x5020000000000000ULL,         0xa040000000000000ULL,         0x4080000000000000ULL
    },
    { // Type bC
        0x102ULL,         0x205ULL,         0x40aULL,         0x814ULL,         0x1028ULL,         0x2050ULL,         0x40a0ULL,         0x8040ULL, 
        0x10201ULL,         0x20502ULL,         0x40a04ULL,         0x81408ULL,         0x102810ULL,         0x205020ULL,         0x40a040ULL,         0x804080ULL, 
        0x1020100ULL,         0x2050200ULL,         0x40a0400ULL,         0x8140800ULL,         0x10281000ULL,         0x20502000ULL,         0x40a04000ULL,         0x80408000ULL, 
        0x102010000ULL,         0x205020000ULL,         0x40a040000ULL,         0x814080000ULL,         0x1028100000ULL,         0x2050200000ULL,         0x40a0400000ULL,         0x8040800000ULL, 
        0x10201000000ULL,         0x20502000000ULL,         0x40a04000000ULL,         0x81408000000ULL,         0x102810000000ULL,         0x205020000000ULL,         0x40a040000000ULL,         0x804080000000ULL, 
        0x1020100000000ULL,         0x2050200000000ULL,         0x40a0400000000ULL,         0x8140800000000ULL,         0x10281000000000ULL,         0x20502000000000ULL,         0x40a04000000000ULL,         0x80408000000000ULL, 
        0x102010000000000ULL,         0x205020000000000ULL,         0x40a040000000000ULL,         0x814080000000000ULL,         0x1028100000000000ULL,         0x2050200000000000ULL,         0x40a0400000000000ULL,         0x8040800000000000ULL, 
        0x201000000000000ULL,         0x502000000000000ULL,         0xa04000000000000ULL,         0x1408000000000000ULL,         0x2810000000000000ULL,         0x5020000000000000ULL,         0xa040000000000000ULL,         0x4080000000000000ULL
    }
};

