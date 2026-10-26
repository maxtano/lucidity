// ============================================================
//  LUCIDITY — Wing v1  (single-part Coandă test ring, long neck)
//  ------------------------------------------------------------
//  Top of the NECK slips over the blower's 16 mm round outlet
//  (tape it on). Air travels ~3in down the neck, spreads in the
//  coned plenum, escapes the bottom ring slit, hugs the outer
//  lip and is thrown DOWN — dragging room air with it (Coandă).
//
//  ★ slit_width is the make-or-break dial. Print 1.0 first,
//    then 0.5 and 2.0; keep whichever moves the load cell most.
//
//  Set values -> F6 -> Export STL (PLA). Print NECK-UP.
// ============================================================

// ---- BLOWER FIT ----
blower_od  = 17.4;   // VERIFIED best-fit socket bore from the fit gauge
sock_fit   = 0.0;    // fit already dialed into the 17.4 above
sock_wall  = 3;

// ---- NECK ----
neck_len   = 80;     // length from blower outlet down to the ring (~3.15 in)

// ---- WING RING ----
wing_od    = 80;     // ring outer diameter
wing_h     = 34;     // ring height (tall enough the plenum cone prints ~support-free)
w_wall     = 3;      // side/bottom wall thickness
top_th     = 3;      // roof thickness
slit_width = 1.0;    // ★ THE KEY DIAL — try 0.5 / 1.0 / 2.0
lip_r      = 3;      // curved outer lip radius (the Coandă surface)
rib_n      = 4;      // ribs bridging the slit so the floor stays attached
rib_w      = 3;

$fn = 160;

module wing_v1(){
    R         = wing_od/2;
    r_slit    = R - w_wall - 1.5;
    neck_od   = blower_od + sock_fit + 2*sock_wall;   // ~22.5
    neck_bore = blower_od + sock_fit;                 // ~16.5
    union(){
        difference(){
            union(){
                cylinder(r=R, h=wing_h);                          // ring body
                translate([0,0,wing_h])                           // long inlet neck
                    cylinder(d=neck_od, h=neck_len);
            }
            // plenum cone: funnels neck air out to the ring (~45° -> prints support-free)
            translate([0,0,w_wall])
                cylinder(r1 = R - w_wall, r2 = neck_bore/2 + 2,
                         h = wing_h - w_wall - top_th);
            // neck bore / air path all the way down into the plenum
            translate([0,0,wing_h - top_th - 0.5])
                cylinder(d = neck_bore, h = neck_len + top_th + 1);
            // downward ring slit: thin annular slot from the bottom up into the plenum
            translate([0,0,-0.01])
                difference(){
                    cylinder(r = r_slit + slit_width/2, h = w_wall + 0.6);
                    cylinder(r = r_slit - slit_width/2, h = w_wall + 0.6);
                }
            // Coandă lip: round the outer bottom edge so the jet hugs it downward
            rotate_extrude() translate([R, 0]) circle(r = lip_r);
        }
        // rib bridges across the slit — keep the floor attached (slit becomes arcs)
        for(i = [0:rib_n-1]) rotate([0,0, i*360/rib_n + 45])
            translate([r_slit - 3, -rib_w/2, 0]) cube([6, rib_w, w_wall]);
    }
}

wing_v1();
