// ============================================================
//  LUCIDITY — Blower-outlet FIT GAUGE
//  A strip of short rings, each a different HOLE DIAMETER,
//  spanning below and above the measured 16 mm spout. Slip each
//  over the blower outlet:
//    - holes smaller than the real spout won't go on (no-go)
//    - the smallest one that slides on with a nice grip = your size
//  Read that number, tell me, and I set the wing neck to it.
//  Print flat, PLA, no supports. Seconds to print.
// ============================================================

wall  = 3;        // ring wall thickness
h     = 6;        // ring height — minimal, just enough to feel the grip
sp    = 32;       // spacing between rings

// actual hole diameters to try (mm) — spans both sides of the 16 mm reading
bores = [16.8, 17.0, 17.2, 17.4, 17.6, 17.8];

$fn = 96;

union(){
    // shared labelled base strip so it prints as one handy piece
    translate([-13, -23, 0]) cube([sp*(len(bores)-1) + 26, 13, 1.6]);
    for(i = [0:len(bores)-1])
        translate([i*sp, 0, 0]){
            // the test ring
            difference(){
                cylinder(d = bores[i] + 2*wall, h = h);
                translate([0,0,-0.5]) cylinder(d = bores[i], h = h + 1);
            }
            // raised hole-diameter label on the strip
            translate([0, -16.5, 1.6])
                linear_extrude(0.8)
                    text(str(bores[i]), size = 4.5, halign = "center", valign = "center");
        }
}
