#include "sp.h"

// declare temp magic bitboard tables (for initial computation and storing)
BishopMagicTable bishop_magics_temp[TOTAL_SQUARES];
RookMagicTable rook_magics_temp[TOTAL_SQUARES];

// BishopMagicTable bishop_magics[TOTAL_SQUARES];
// RookMagicTable rook_magics[TOTAL_SQUARES];


// Array storing bishop max num blockers at chezz board index
const int BISHOP_RELEVANT_BITS[TOTAL_SQUARES] = {
    6, 5, 5, 5, 5, 5, 5, 6,
    5, 5, 5, 5, 5, 5, 5, 5,
    5, 5, 7, 7, 7, 7, 5, 5,
    5, 5, 7, 9, 9, 7, 5, 5,
    5, 5, 7, 9, 9, 7, 5, 5,
    5, 5, 7, 7, 7, 7, 5, 5,
    5, 5, 5, 5, 5, 5, 5, 5,
    6, 5, 5, 5, 5, 5, 5, 6
};


// Array storing rook max num blockers at chezz board index
const int ROOK_RELEVANT_BITS[TOTAL_SQUARES] = {
    12, 11, 11, 11, 11, 11, 11, 12,
    11, 10, 10, 10, 10, 10, 10, 11,
    11, 10, 10, 10, 10, 10, 10, 11,
    11, 10, 10, 10, 10, 10, 10, 11,
    11, 10, 10, 10, 10, 10, 10, 11,
    11, 10, 10, 10, 10, 10, 10, 11,
    11, 10, 10, 10, 10, 10, 10, 11,
    12, 11, 11, 11, 11, 11, 11, 12
};


/*
 * Init magic tables for rooks and bishops.
 * Returns nothing.
 */
void init_magic_tables() {

    // iterate over all squares
    for (int square = 0; square < TOTAL_SQUARES; square++) {
        
        // set bishop magic table struct
        bishop_magics_temp[square].mask = gen_bishop_mask(square);
        bishop_magics_temp[square].relevant_bits = BISHOP_RELEVANT_BITS[square];
        
        // set rook magic table struct
        rook_magics_temp[square].mask = gen_rook_mask(square);
        rook_magics_temp[square].relevant_bits = ROOK_RELEVANT_BITS[square];
    }

    // compute actual attack tables
    compute_magic_attack_tables();
}


/*
 * Precomputes attack bitboards for all blocker configs for bishops and rooks.
 * Returns nothing.
 */
void compute_magic_attack_tables() {
    
    /* 1. Iterate over squares and setup masks */
    for (int square = 0; square < TOTAL_SQUARES; square++) {
        
        // retrieve bitmask
        Bitboard bishop_mask = bishop_magics_temp[square].mask;
        Bitboard rook_mask = rook_magics_temp[square].mask;

        // retrieve num relevant bits
        int bishop_relevant_bits = bishop_magics_temp[square].relevant_bits;
        int rook_relevant_bits = rook_magics_temp[square].relevant_bits;

        // compute num possible blocker configs
        int num_blocker_combinations_bishop = 1 << bishop_relevant_bits; // 2^n blocker sets
        int num_blocker_combinations_rook = 1 << rook_relevant_bits;     // 2^n blocker sets

        
        /* 2. Compute bishop attack tables */
        for (int i = 0; i < num_blocker_combinations_bishop; i++) {
            
            // generate bitboard blocker config
            Bitboard blocker = gen_blocker_config(i, bishop_relevant_bits, bishop_mask);
            
            // compute attack set for blocker config
            Bitboard attack = gen_bishop_attacks(square, blocker);
            
            // compute magic index to access attack bitboard
            Bitboard index = (blocker * bishop_magics_temp[square].magic_number) >> (64 - bishop_relevant_bits);
            index &= ((1ULL << bishop_relevant_bits) - 1);
            
            // store attack bitboard for blocker config at magic index
            bishop_magics_temp[square].attack_table[index] = attack;
        }

        
        /* 3. Compute rook attack tables */
        for (int i = 0; i < num_blocker_combinations_rook; i++) {
            
            // generate bitboard blocker config
            Bitboard blocker = gen_blocker_config(i, rook_relevant_bits, rook_mask);
            
            // compute attack set for blocker config
            Bitboard attack = gen_rook_attacks(square, blocker);
            
            // compute magic index to access attack bitboard
            Bitboard index = (blocker * rook_magics_temp[square].magic_number) >> (64 - rook_relevant_bits);
            index &= ((1ULL << rook_relevant_bits) - 1);

            // store attack bitboard for blocker config at magic index
            rook_magics_temp[square].attack_table[index] = attack;
        }
    }
}


/*
 * Gen a specific blocker configuration for a given index.
 * index: Index representing the blocker pattern.
 * num_bits: Number of relevant bits in mask.
 * mask: Bitboard mask of possible blocker positions.
 * Returns bitboard representing the blocker config.
 */
Bitboard gen_blocker_config(int index, int num_bits, Bitboard mask) {
   
    Bitboard blocker = 0;
    int bit_count = 0;

    // iterate over all bits in the mask
    for (int i = 0; i < TOTAL_SQUARES; i++) {

        // stop if processed all relevant bits
        if (bit_count >= num_bits) 
            break;

        // if current bit is part of the blocker set, determine value
        if (mask & (1ULL << i)) {
            
            // if index has this bit set, set it in blocker
            if (index & (1ULL << bit_count)) { 
                blocker |= (1ULL << i);
            }
            
            // increment
            bit_count++;
        }
    }

    return blocker;
}


/*
 * Gen bishop attack bitboard given blockers.
 * square: Starting square index (0-63).
 * blockers: Bitboard of blocking pieces.
 * Returns bitboard with bits set (for bishop attack squares).
 */
Bitboard gen_bishop_attacks(int square, Bitboard blockers) {
    
    Bitboard attacks = 0;

    // compute bishop's row and column
    int row = square / 8;
    int col = square % 8;

    // bishop moves diagonally in 4 directions
    int directions[4][2] = {
        {1, 1},
        {-1, 1},
        {1, -1},
        {-1, -1}
    };

    // iterate over each diagonal direction
    for (int d = 0; d < 4; d++) {
        
        int dx = directions[d][0];
        int dy = directions[d][1];
        int new_row = row;
        int new_col = col;

        // move bishop in the diagonal direction until out of bounds
        while (1) {

            // increment pos by displacement
            new_col += dx;
            new_row += dy;

            // stop if out of the board
            if (new_row < 0 || new_row >= 8 || new_col < 0 || new_col >= 8) 
                break;

            // convert (row, col) to bitboard index
            int target = new_row * 8 + new_col;

            // mark this square as an attackable pos
            attacks |= (1ULL << target);

            // stop if there's a blocker
            if (blockers & (1ULL << target)) 
                break;
        }
    }

    return attacks;
}


/*
 * Gen rook attack bitboard given blockers.
 * square: Starting square index (0-63).
 * blockers: Bitboard of blocking pieces.
 * Returns bitboard with bits set (for rook attack squares).
 */
Bitboard gen_rook_attacks(int square, Bitboard blockers) {
    
    Bitboard attacks = 0;

    // compute rook's row and column
    int row = square / 8;
    int col = square % 8;

    // rook moves in 4 straight directions (up, down, left, right)
    int directions[4][2] = {
        {0, 1},
        {0, -1},
        {1, 0},
        {-1, 0}
    };

    // iterate over each direction
    for (int d = 0; d < 4; d++) {
        
        int dx = directions[d][0];
        int dy = directions[d][1];

        int new_col = col;
        int new_row = row;

        // move rook in the current direction until out of bounds
        while (1) {

            // increment pos by displacement
            new_col += dx;
            new_row += dy;

            // stop if out of the board
            if (new_row < 0 || new_row >= 8 || new_col < 0 || new_col >= 8) 
                break;

            // convert (row, col) to bitboard index
            int target = new_row * 8 + new_col;

            // mark this square as an attackable pos
            attacks |= (1ULL << target);

            // stop if there's a blocker
            if (blockers & (1ULL << target)) 
                break;
        }
    }

    return attacks;
}


/*
 * Gen a random 64-bit magic number with constraints.
 * Returns bitboard with MSB set and mixed LSBs.
 */
Bitboard gen_random_magic() {
    return ((Bitboard)rand() & 0xFFFF) | 
           ((Bitboard)rand() & 0xFFFF) << 16 |
           ((Bitboard)rand() & 0xFFFF) << 32 |
           ((Bitboard)rand() & 0xFFFF) << 48 |
           (1ULL << 63);  // MSB is set for better hashing
}


/*
 * Finds a valid magic number for a bishop or rook square.
 * square: Square index (0-63).
 * relevant_bits: Number of relevant blocker bits.
 * is_bishop: 1 for bishop, 0 for rook.
 * Returns bitboard representing the valid magic number, or 0 if failed.
 */
Bitboard find_magic_number(int square, int relevant_bits, int is_bishop) {

    /* 1. Allocate and setup blocker/attack arrays */
    // allocate used on the heap instead of stack to prevent overflow
    Bitboard *used = (Bitboard *)calloc(1ULL << relevant_bits, sizeof(Bitboard));

    if (!used) {
        printf("Error: Memory allocation failed for magic search!\n");
        exit(1);
    }

    Bitboard rook_blockers[MAX_ROOK_ATTACKS], rook_attacks[MAX_ROOK_ATTACKS];
    Bitboard bishop_blockers[MAX_BISHOP_ATTACKS], bishop_attacks[MAX_BISHOP_ATTACKS];

    // get possible moves for piece from square
    Bitboard mask = is_bishop ? gen_bishop_mask(square) : gen_rook_mask(square);
    
    // 2^n possible blocker states
    int num_blockers = 1 << relevant_bits;

    // generate all possible blocker configs
    for (int i = 0; i < num_blockers; i++) {

        if (is_bishop) {
            bishop_blockers[i] = gen_blocker_config(i, relevant_bits, mask);
            bishop_attacks[i] = gen_bishop_attacks(square, bishop_blockers[i]);
        } else {
            rook_blockers[i] = gen_blocker_config(i, relevant_bits, mask);
            rook_attacks[i] = gen_rook_attacks(square, rook_blockers[i]);
        }
    }


    /* 2. Test random magic numbers */
    // try random magic numbers until one works
    for (int attempt = 0; attempt < 100000000; attempt++) {
        
        // calling 3 times increases randomness by using (bitwise AND)
        Bitboard magic = gen_random_magic() & gen_random_magic() & gen_random_magic();

        // ensure magic number has enough randomness in the high bits
        if ((__builtin_popcountll((magic * mask) >> 56) < 5)) {  
            continue;  
        }
        
        // reset the used attack table
        memset(used, 0, sizeof(Bitboard) * (1ULL << relevant_bits));

        // set true
        int valid = 1;

        // test magic num, iterating through all possible blocker configs
        for (int i = 0; i < num_blockers; i++) {
            
            Bitboard index = 0;

            // compute magic index, should not exceed table size
            if (is_bishop) {
                index = (bishop_blockers[i] * magic) >> (64 - relevant_bits);
            } else {
                index = (rook_blockers[i] * magic) >> (64 - relevant_bits);
            }

            index &= (1ULL << relevant_bits) - 1;  // mask index
            

            // if index is unused, store attack set
            if (used[index] == 0) {

                if (is_bishop) {
                    used[index] = bishop_attacks[i];
                } else {
                    used[index] = rook_attacks[i];
                }
            } 
            // if index used but maps to a different attack set, discard magic num
            else if (used[index] != (is_bishop ? bishop_attacks[i] : rook_attacks[i])) {
                valid = 0;
                break;
            }
        }

        // found valid magic num
        if (valid) {
            free(used);
            return magic;
        }
    }

    /* 3. Cleanup and fail if no magic found */
    printf("Failed to find a magic number!\n");
    free(used);

    return 0;
}


/*
 * Gen magic numbers for all squares of a piece type.
 * is_bishop: 1 for bishop, 0 for rook.
 * Returns nothing.
 */
void gen_magic_numbers(int is_bishop) {

    // iterate through all squares and try finding magic numbers
    for (int square = 0; square < TOTAL_SQUARES; square++) {
        
        int max_attempts = 10;
        int attempt = 0;
        
        Bitboard magic = 0;

        // try 5 attempts
        while (attempt < max_attempts) {
            magic = find_magic_number(square, 
                                      is_bishop ? BISHOP_RELEVANT_BITS[square] : ROOK_RELEVANT_BITS[square], 
                                      is_bishop);

            // if valid magic number, break out of loop
            if (magic != 0) {
                break;
            }

            printf("Warning: Failed to find valid magic number for %s square %d (attempt %d/%d), retrying...\n", 
                   is_bishop ? "bishop" : "rook", square, attempt + 1, max_attempts);
            
            // increment attempt counter
            attempt++;
        }

        // if exhausted attempts, exit
        if (magic == 0) {
            printf("Error: Could not find a valid magic number for %s square %d after %d attempts.\n", 
                   is_bishop ? "bishop" : "rook", square, max_attempts);
            exit(1);
        }

        // set magic number
        if (is_bishop) {
            bishop_magics_temp[square].magic_number = magic;
        } else {
            rook_magics_temp[square].magic_number = magic;
        }
    }
}


/*
 * Saves bishop and rook magic tables to sp_table.dat file. Used for testing.
 * Returns nothing.
 * Note: MAGIC_TABLE_FILE was a .dat file for testing, now .c file, so reset MAGIC_TABLE_FILE when generating.
 */
void save_magic_tables() {

    FILE *file = fopen(MAGIC_TABLE_FILE, "wb");

    if (!file) {
        printf("Error: Cannot write magic numbers!\n");
        return;
    }
    
    int num_entries;

    // save bishop magic tables
    for (int square = 0; square < TOTAL_SQUARES; square++) {

        // Write fixed fields
        fwrite(&bishop_magics_temp[square].mask, sizeof(Bitboard), 1, file);
        fwrite(&bishop_magics_temp[square].relevant_bits, sizeof(int), 1, file);
        fwrite(&bishop_magics_temp[square].magic_number, sizeof(Bitboard), 1, file);
        
        // write size of attack table (2^relevant_bits)
        num_entries = 1 << bishop_magics_temp[square].relevant_bits;
        fwrite(&num_entries, sizeof(int), 1, file);
        
        // write the attack_table data
        fwrite(&bishop_magics_temp[square].attack_table, sizeof(Bitboard), num_entries, file);
    }
    
    // save rook magic tables
    for (int square = 0; square < TOTAL_SQUARES; square++) {

        fwrite(&rook_magics_temp[square].mask, sizeof(Bitboard), 1, file);
        fwrite(&rook_magics_temp[square].relevant_bits, sizeof(int), 1, file);
        fwrite(&rook_magics_temp[square].magic_number, sizeof(Bitboard), 1, file);
        
        num_entries = 1 << rook_magics_temp[square].relevant_bits;
        fwrite(&num_entries, sizeof(int), 1, file);
        
        fwrite(rook_magics_temp[square].attack_table, sizeof(Bitboard), num_entries, file);
    }
    
    fclose(file);
}


/*
 * Loads bishop and rook magic tables from sp_table.dat file. Used for testing.
 * Returns nothing.
 */
void load_magic_tables() {
    FILE *file = fopen(MAGIC_TABLE_FILE, "rb");

    if (!file) {
        printf("Magic number file not found. Generating new magic numbers...\n");
        gen_magic_numbers(1);
        gen_magic_numbers(0);
        init_magic_tables();
        save_magic_tables();
        return;
    }

    int num_entries;

    // load bishop magic tables
    for (int square = 0; square < TOTAL_SQUARES; square++) {
        
        // read fixed fields
        fread(&bishop_magics_temp[square].mask, sizeof(Bitboard), 1, file);
        fread(&bishop_magics_temp[square].relevant_bits, sizeof(int), 1, file);
        fread(&bishop_magics_temp[square].magic_number, sizeof(Bitboard), 1, file);
        
        // read size of attack table (2^relevant_bits)
        fread(&num_entries, sizeof(int), 1, file);

        // read the attack_table data
        fread(bishop_magics_temp[square].attack_table, sizeof(Bitboard), num_entries, file);    
    }
    
    // load rook magic tables
    for (int square = 0; square < TOTAL_SQUARES; square++) {

        // read fixed fields
        fread(&rook_magics_temp[square].mask, sizeof(Bitboard), 1, file);
        fread(&rook_magics_temp[square].relevant_bits, sizeof(int), 1, file);
        fread(&rook_magics_temp[square].magic_number, sizeof(Bitboard), 1, file);
        
        // read size of attack table (2^relevant_bits)
        fread(&num_entries, sizeof(int), 1, file);

        // read the attack_table data
        fread(rook_magics_temp[square].attack_table, sizeof(Bitboard), num_entries, file);
    }

    // printf("rook\n");
    // for (int i=0; i < TOTAL_SQUARES; i++){
    //     printf("%#lxULL,\n", rook_magics_temp[i].magic_number);
    // }

    // printf("bishop\n");
    // for (int i=0; i < TOTAL_SQUARES; i++){
    //     printf("%#lxULL,\n", bishop_magics_temp[i].magic_number);
    // }
    
    fclose(file);
}


/*
 * Exports bishop or rook magic table from bishop_magics_temp or bishop_magics_temp to a .c file.
 * is_bishop: 1 for bishop, 0 for rook.
 * Returns nothing.
 */
void export_magic_table(int is_bishop) {
    FILE *file = fopen(is_bishop ? "bishop_magic.c" : "rook_magic.c", "w");

    if (!file) {
        printf("Error: Cannot open output file!\n");
        return;
    }

    fprintf(file, "#include \"sp.h\"\n\n");

    // table declaration
    fprintf(file, "%sMagicTable %s_magics[TOTAL_SQUARES] = {\n", 
            is_bishop ? "Bishop" : "Rook",
            is_bishop ? "bishop" : "rook");

    for (int square = 0; square < 64; square++) {
        fprintf(file, "    { %#" PRIx64 "ULL, %#" PRIx64 "ULL, {", 
            (uint64_t)(is_bishop ? bishop_magics_temp[square].magic_number : rook_magics_temp[square].magic_number),
            (uint64_t)(is_bishop ? bishop_magics_temp[square].mask : rook_magics_temp[square].mask));

        int num_entries = 1 << (is_bishop ? bishop_magics_temp[square].relevant_bits : rook_magics_temp[square].relevant_bits);

        for (int i = 0; i < num_entries; i++) {
            fprintf(file, " %#" PRIx64 "ULL%s", 
                (uint64_t)(is_bishop ? bishop_magics_temp[square].attack_table[i] : rook_magics_temp[square].attack_table[i]),
                (i < num_entries - 1) ? "," : "");
        }

        fprintf(file, " }, %d },\n", 
                is_bishop ? bishop_magics_temp[square].relevant_bits : rook_magics_temp[square].relevant_bits);
    }

    fprintf(file, "};\n\n");

    fclose(file);
    printf("%s magic table successfully exported!\n", is_bishop ? "Bishop" : "Rook");
}
