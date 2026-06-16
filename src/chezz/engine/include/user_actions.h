/* Header file for user-facing Chezz action generation helpers. */

#ifndef USER_ACTIONS_H
#define USER_ACTIONS_H

#include "gen_valid_boards.h"

#ifdef _WIN32
#define UA_API __declspec(dllexport)
#else
#define UA_API
#endif

typedef enum {
    UA_ACTION_UNKNOWN = 0,
    UA_ACTION_MOVE,
    UA_ACTION_SHOOT,
    UA_ACTION_FLING
} UAActionKind;

typedef struct {
    UAActionKind kind;
    int from;
    int to;
    int square;
    int payload;
    int target;
    char direction[3];
    char action_key[32];
} UAAction;

typedef enum {
    UA_EVENT_ACTION = 0,
    UA_EVENT_CAPTURE,
    UA_EVENT_MOVE,
    UA_EVENT_PROMOTION,
    UA_EVENT_CONTAGION
} UAEventType;

typedef struct {
    UAEventType type;
    char action[24];
    char piece[3];
    char from_piece[3];
    char to_piece[3];
    char direction[3];
    int square;
    int from_square;
    int to_square;
    int payload_square;
    int target_square;
} UAEvent;

typedef struct {
    Chezzboard *boards;
    UAAction *actions;
    UAEvent *events;
    size_t *event_offsets;
    size_t *event_counts;
    size_t events_count;
    size_t events_capacity;
    size_t count;
    size_t capacity;
} UAValidBoards;

/* Caller must release returned buffers with ua_free_chezz_actions. */
UA_API UAValidBoards ua_gen_chezz_boards(Chezzboard *board, int color);

UA_API void ua_free_chezz_actions(UAValidBoards *chezz_actions);

#endif // USER_ACTIONS_H
