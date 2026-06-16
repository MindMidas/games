#ifndef PHYLIB_H
#define PHYLIB_H

#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

/* Constants */

/* PHYLIB_BALL_RADIUS: radius of a ball. */
#define PHYLIB_BALL_RADIUS (28.5) // mm

/* PHYLIB_BALL_DIAMETER: diameter of a ball. */
#define PHYLIB_BALL_DIAMETER (2 * PHYLIB_BALL_RADIUS)

/* PHYLIB_HOLE_RADIUS: pocket radius (~1.25× ball diameter). */
#define PHYLIB_HOLE_RADIUS (PHYLIB_BALL_DIAMETER * 1.25)

/* PHYLIB_TABLE_LENGTH: length of the table. */
#define PHYLIB_TABLE_LENGTH (2700.0) // mm

/* PHYLIB_TABLE_WIDTH: width of the table. */
#define PHYLIB_TABLE_WIDTH (PHYLIB_TABLE_LENGTH / 2.0) // mm

/* PHYLIB_SIM_RATE: simulation rate. */
#define PHYLIB_SIM_RATE (0.0001) // s

/* PHYLIB_VEL_EPSILON: velocity epsilon. */
#define PHYLIB_VEL_EPSILON (0.01) // mm/s

/* PHYLIB_DRAG: drag coefficient. */
#define PHYLIB_DRAG (150.0) // mm/s^2

/* PHYLIB_MAX_TIME: maximum simulation time. */
#define PHYLIB_MAX_TIME (600) // s

/* PHYLIB_MAX_OBJECTS: maximum number of objects on the table. */
#define PHYLIB_MAX_OBJECTS (26)

/* Enumerations and Structures */

/* phylib_obj: enumeration that represents the types of physics objects. */
typedef enum {
    PHYLIB_STILL_BALL = 0,
    PHYLIB_ROLLING_BALL = 1,
    PHYLIB_HOLE = 2,
    PHYLIB_HCUSHION = 3,
    PHYLIB_VCUSHION = 4
} phylib_obj;

/* phylib_coord: structure that represents a 2D vector. */
typedef struct {
    double x; // x-coordinate
    double y; // y-coordinate
} phylib_coord;


/* (Child) Classes that represent objects on the table */

/* phylib_still_ball: structure that represents a still ball on the table. */
typedef struct {
    unsigned char number; // ball number
    phylib_coord pos;     // ball position
} phylib_still_ball;

/* phylib_rolling_ball: structure that represents a rolling ball on the table. */
typedef struct {
    unsigned char number; // ball number
    phylib_coord pos;     // ball position
    phylib_coord vel;     // ball velocity
    phylib_coord acc;     // ball acceleration
} phylib_rolling_ball;

/* phylib_hole: structure that represents a hole on the table. */
typedef struct {
    phylib_coord pos; // hole position
} phylib_hole;

/* phylib_hcushion: structure that represents a horizontal cushion on the table. */
typedef struct {
    double y; // y-coordinate of the cushion
} phylib_hcushion;

/* phylib_vcushion: structure that represents a vertical cushion on the table. */
typedef struct {
    double x; // x-coordinate of the cushion
} phylib_vcushion;

/* phylib_untyped: union that represents polymorphic objects on the table. */
typedef union {
    phylib_still_ball still_ball;
    phylib_rolling_ball rolling_ball;
    phylib_hole hole;
    phylib_hcushion hcushion;
    phylib_vcushion vcushion;
} phylib_untyped;

/* phylib_object: structure that represents a generic object on the table. */
typedef struct {
    phylib_obj type;    // type of the object
    phylib_untyped obj; // object data 
} phylib_object;

/* phylib_table: structure that represents the table. */
typedef struct {
    double time;                               // time associated with table configuration
    phylib_object *object[PHYLIB_MAX_OBJECTS]; // array of pointers to physics objects on the table 
} phylib_table;


/* Function Prototypes for constructor methods */

// Part 1

/*
 * Allocate and initialise a new phylib_object representing a still ball.
 * number: The ball number.
 * pos: Ptr to the ball position vector.
 * Returns ptr to the allocated object, or NULL if malloc fails.
 */
phylib_object *phylib_new_still_ball(unsigned char number, phylib_coord *pos);

/*
 * Allocate and initialise a new phylib_object representing a rolling ball.
 * number: The ball number.
 * pos: Ptr to the ball position vector.
 * vel: Ptr to the ball velocity vector.
 * acc: Ptr to the ball acceleration vector.
 * Returns ptr to the allocated object, or NULL if malloc fails.
 */
phylib_object *phylib_new_rolling_ball(unsigned char number, phylib_coord *pos, phylib_coord *vel, phylib_coord *acc);

/*
 * Allocate and initialise a new phylib_object representing a pocket hole.
 * pos: Ptr to the hole position vector.
 * Returns ptr to the allocated object, or NULL if malloc fails.
 */
phylib_object *phylib_new_hole(phylib_coord *pos);

/*
 * Allocate and initialise a new phylib_object representing a horizontal cushion.
 * y: Y-coordinate of the cushion.
 * Returns ptr to the allocated object, or NULL if malloc fails.
 */
phylib_object *phylib_new_hcushion(double y);

/*
 * Allocate and initialise a new phylib_object representing a vertical cushion.
 * x: X-coordinate of the cushion.
 * Returns ptr to the allocated object, or NULL if malloc fails.
 */
phylib_object *phylib_new_vcushion(double x);

/*
 * Allocate and initialise a new phylib_table with cushions and holes in standard positions.
 * Returns ptr to the allocated table, or NULL if malloc fails.
 */
phylib_table *phylib_new_table( void );


// Part 2

/*
 * Deep-copies a phylib_object from src into dest via malloc.
 * dest: Ptr-to-ptr that receives the copied object address.
 * src: Ptr-to-ptr to the source object.
 * Nothing.
 */
void phylib_copy_object( phylib_object **dest, phylib_object **src );

/*
 * Deep-copy a phylib_table to a new memory location.
 * table: Ptr to the source table.
 * Returns ptr to the newly allocated copy, or NULL if malloc fails.
 */
phylib_table *phylib_copy_table( phylib_table *table );

/*
 * Add a phylib_object to the first NULL slot in a phylib_table.
 * table: Ptr to the target table.
 * object: Ptr to the object to add.
 * Nothing.
 */
void phylib_add_object( phylib_table *table, phylib_object *object );

/*
 * Free all objects in a table and the table struct itself.
 * table: Ptr to the table to free.
 * Nothing.
 */
void phylib_free_table(phylib_table *table);

/*
 * Subtract two 2D coordinate vectors.
 * c1: Minuend vector.
 * c2: Subtrahend vector.
 * Returns resulting difference vector.
 */
phylib_coord phylib_sub(phylib_coord c1, phylib_coord c2);

/*
 * Compute the Euclidean length of a 2D vector.
 * c: Input vector.
 * Returns length of c.
 */
double phylib_length(phylib_coord c);

/*
 * Compute the dot product of two 2D vectors.
 * a: First vector.
 * b: Second vector.
 * Returns dot product of a and b.
 */
double phylib_dot_product(phylib_coord a, phylib_coord b);

/*
 * Compute distance between two physics objects when applicable.
 * obj1: First object (must be a rolling ball).
 * obj2: Second object (rolling ball, cushion, or hole).
 * Returns calculated distance, or -1.0 when object types are invalid.
 */
double phylib_distance(phylib_object *obj1, phylib_object *obj2);


// Part 3

/*
 * Advance a rolling ball over elapsed time, writing the new state to new.
 * new: Output object receiving the updated rolling-ball state.
 * old: Input rolling ball before integration.
 * time: Elapsed simulation time in seconds.
 * Nothing.
 */
void phylib_roll(phylib_object *new, phylib_object *old, double time);

/*
 * Determine whether a rolling ball has come to rest.
 * object: Ptr to the rolling-ball object to test.
 * Returns 1 if the ball was converted to still, 0 if it remains rolling.
 */
unsigned char phylib_stopped( phylib_object *object );

/*
 * Resolve a collision between two table objects, updating both in place.
 * a: Ptr-to-ptr to the first colliding object.
 * b: Ptr-to-ptr to the second colliding object.
 * Nothing.
 */
void phylib_bounce( phylib_object **a, phylib_object **b );

/*
 * Count rolling balls currently on the table.
 * t: Ptr to the table to inspect.
 * Returns number of rolling balls.
 */
unsigned char phylib_rolling( phylib_table *t );

/*
 * Advance simulation to the next collision event.
 * table: Ptr to the current table state.
 * Returns ptr to the table state at the next event, or NULL when no rolling balls remain.
 */
phylib_table *phylib_segment( phylib_table *table );


// Helper functions

/*
 * Reflect a rolling ball off a horizontal cushion.
 * ball: Ptr to the rolling-ball object.
 * Nothing.
 */
void handleHCushionCollision(phylib_object *ball);

/*
 * Reflect a rolling ball off a vertical cushion.
 * ball: Ptr to the rolling-ball object.
 * Nothing.
 */
void handleVCushionCollision(phylib_object *ball);

/*
 * Pocket a rolling ball when it overlaps a hole.
 * ball: Ptr-to-ptr to the ball object (set to NULL when pocketed).
 * Nothing.
 */
void handleHoleCollision(phylib_object **ball);

/*
 * Convert a still ball into a rolling ball with zero initial velocity.
 * stillBall: Ptr to the still-ball object to upgrade.
 * Nothing.
 */
void upgradeStillBallToRollingBall(phylib_object *stillBall);

/*
 * Resolve a ball-ball collision between two rolling balls.
 * a: First rolling-ball object.
 * b: Second rolling-ball object.
 * Nothing.
 */
void handleRollingBallCollision(phylib_object *a, phylib_object *b);

/*
 * Format a phylib_object as a human-readable string for debugging.
 * object: Ptr to the object to describe.
 * Returns ptr to a static string describing the object.
 */
char *phylib_object_string(phylib_object *object);

#endif /* PHYLIB_H */


