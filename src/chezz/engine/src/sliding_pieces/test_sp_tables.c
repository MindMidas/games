#include "sp.h"
#include "debug.h"


/*
 * Verifies that each magic number maps to a unique attack bitboard for bishops and rooks.
 * Returns nothing.
 */
void verify_unique_magic_mappings() {
    int square;
    
    /* 1. Verify bishop magic mappings */
    for (square = 0; square < TOTAL_SQUARES; square++) {
        int relevant_bits = bishop_magics[square].relevant_bits;
        Bitboard mask = bishop_magics[square].mask;
        int num_configurations = 1 << relevant_bits;
        Bitboard *seen = (Bitboard*) calloc(num_configurations, sizeof(Bitboard));

        if (!seen) {
            printf("Memory allocation failed during verification!\n");
            exit(1);
        }

        //  printf("Bishop num_configurations: %d\n", num_configurations);

        for (int i = 0; i < num_configurations; i++) {

            Bitboard blocker_bitboard = gen_blocker_config(i, relevant_bits, mask);
            Bitboard index = (blocker_bitboard * bishop_magics[square].magic_number) >> (64 - relevant_bits);
            index &= ((1ULL << relevant_bits) - 1);

            Bitboard attack = bishop_magics[square].attack_table[index];
            
            // if nothing stored at index yet, store attack bitboard
            if (seen[index] == 0)
                seen[index] = attack;
            else if (seen[index] != attack) {
                printf("Non-unique mapping for bishop on square %d at index %llu\n", square, (unsigned long long)index);
                free(seen);
                return;
            } else {
                printf("Nothing here");
            }
        }
        free(seen);
    }

    /* 2. Verify rook magic mappings */
    for (square = 0; square < TOTAL_SQUARES; square++) {

        int relevant_bits = rook_magics[square].relevant_bits;
        Bitboard mask = rook_magics[square].mask;
        int num_configurations = 1 << relevant_bits;
        Bitboard *seen = (Bitboard*) calloc(num_configurations, sizeof(Bitboard));
        if (!seen) {
            printf("Memory allocation failed during verification!\n");
            exit(1);
        }

        // printf("Rook num_configurations: %d\n", num_configurations);

        for (int i = 0; i < num_configurations; i++) {
            Bitboard blocker_bitboard = gen_blocker_config(i, relevant_bits, mask);
            Bitboard index = (blocker_bitboard * rook_magics[square].magic_number) >> (64 - relevant_bits);
            index &= ((1ULL << relevant_bits) - 1);

            Bitboard attack = rook_magics[square].attack_table[index];
            
            // if (i==100){
            //     printf("ROOK POS: %s\n", square_lookup[square]);
            //     printf("blocker_bitboard\n");
            //     print_bitboard_state(blocker_bitboard);
            //     printf("ATTACK\n");
            //     print_bitboard_state(attack);
            // }

            // check if we've already stored a mapping at this index
            if (seen[index] == 0)
                seen[index] = attack;
            else if (seen[index] != attack) {
                printf("Non-unique mapping for rook on square %d at index %llu\n", square, (unsigned long long)index);
                free(seen);
                return;
            }else {
                printf("Nothing here");
            }
        }
        free(seen);
    }

    printf("All magic mappings are unique.\n");
}


/*
 * Prints the sizes of bishop and rook attack tables for each square.
 * Returns nothing.
 */
void print_attack_table_sizes() {
    for (int square = 0; square < TOTAL_SQUARES; square++) {
        int bishop_size = 1 << bishop_magics[square].relevant_bits;
        int rook_size   = 1 << rook_magics[square].relevant_bits;
        
        printf("Square %2d: Bishop attack table size = %4d", square, bishop_size);
        if (bishop_size > MAX_BISHOP_ATTACKS)
            printf("  [ERROR: exceeds 512]");
        printf(" | Rook attack table size = %3d", rook_size);
        if (rook_size > MAX_ROOK_ATTACKS)
            printf("  [ERROR: exceeds 4096]");
        printf("\n");
    }
}


/*
 * Compares two bitboards for qsort.
 * a: Ptr to the 1st Bitboard.
 * b: Ptr to the 2nd Bitboard.
 * Returns -1 if a < b, 1 if a > b, 0 if equal.
 */
static int compare_uint64(const void *a, const void *b) {
    
    Bitboard x = *(const Bitboard *)a;
    Bitboard y = *(const Bitboard *)b;
    
    if (x < y) 
        return -1;
    
    if (x > y) 
        return  1;
    
    return 0;
}


/*
 * Summarizes attack bitboards for bishops and rooks, counting unique entries & duplicates.
 * Returns nothing.
 */
void summarize_attack_bitboards() {
    
    /* 1. Summarize bishop attack tables */
    printf("\n=== Bishop Attack Table Summary ===\n");
    
    for (int square = 0; square < TOTAL_SQUARES; square++) {
        
        int num_entries = 1 << bishop_magics[square].relevant_bits;

        // qsort attack table
        qsort(bishop_magics[square].attack_table, num_entries, sizeof(Bitboard), compare_uint64);

        // count unique bitboards & duplicates
        int unique_count = 0;
        int total_duplicates = 0;

        for (int i = 0; i < num_entries; ) {
            
            int j = i + 1;

            // increment j while bitboards match
            while (j < num_entries && bishop_magics[square].attack_table[j] == bishop_magics[square].attack_table[i]) {
                j++;
            }
            
            // frequency of this bitboard
            int freq = j - i;
            unique_count++;
            
            // if freq > 1, there are (freq - 1) duplicates for this bitboard
            total_duplicates += (freq - 1);

            // set i to j
            i = j;
        }

        printf("Square %s: total entries = %4d, unique = %4d, duplicates = %4d\n",
               square_lookup[square], num_entries, unique_count, total_duplicates);
    }

    
    /* 2. Summarize rook attack tables */
    printf("\n=== Rook Attack Table Summary ===\n");

    for (int square = 0; square < TOTAL_SQUARES; square++) {
        
        int num_entries = 1 << rook_magics[square].relevant_bits;

        // qsort attack table
        qsort(rook_magics[square].attack_table, num_entries, sizeof(Bitboard), compare_uint64);

        // count unique bitboards & duplicates
        int unique_count = 0;
        int total_duplicates = 0;

        for (int i = 0; i < num_entries; ) {

            int j = i + 1;

            // increment j while bitboards match
            while (j < num_entries && rook_magics[square].attack_table[j] == rook_magics[square].attack_table[i]) {
                j++;
            }
            
            // frequency of this bitboard
            int freq = j - i;
            unique_count++;

            // if freq > 1, there are (freq - 1) duplicates for this bitboard
            total_duplicates += (freq - 1);

            // set i to j
            i = j;
        }

        printf("Square %s: total entries = %4d, unique = %4d, duplicates = %4d\n",
               square_lookup[square], num_entries, unique_count, total_duplicates);
    }
}
