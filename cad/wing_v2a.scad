// ============================================================
//  LUCIDITY — Wing v2a  (research-optimized Coandă donut, 2-piece)
//  ------------------------------------------------------------
//  SAME optimized body as before (attached Coandă turn ~9x slit,
//  converging throat, gentle diffuser, open center, smooth ring).
//  Split into TOP + BOTTOM so the 1 mm slit is the built-in GAP
//  between them (how real bladeless fans are made) — robust slit,
//  clean support-free print, easy to bond.
//    part = "bottom" | "top" | "assembled"(preview)
//  Print bottom + top separately; an alignment lip self-centers
//  them; the top's recessed inner edge sets the slit; bond the
//  outer seam.
// ============================================================

part = "assembled";

throat_r0  = 23;    // throat (mixing) radius
Rc         = 9;     // Coandă turn radius (~9x the 1mm slit)
mix_len    = 6;     // cylindrical mixing throat length
diff_len   = 12;    // diffuser length
diff_ang   = 8;     // diffuser half-angle
R          = 54;    // outer radius (widened so plenum takes a full-size feed)
wall       = 2.2;
slit_width = 1.0;   // <-- slit gap = this
sock_bore  = 17.4;  // blower fit (verified)
sock_wall  = 3;
neck_len   = 30;

exit_r = throat_r0 + diff_len*tan(diff_ang);
z0 = 0; z1 = diff_len; z2 = diff_len+mix_len; z3 = z2 + Rc; z_top = z3 + 9;
r_neck = ((throat_r0+Rc+wall) + (R-wall))/2;
top_r = 6; bot_r = 6;
split_z = z3;          // split at the Coandă top / slit level
reg_h   = 3;           // alignment-lip height
$fn = 160;

function arcpts(cx,cz,r,a0,a1,n=18) =
    [for(i=[0:n]) let(a=a0+(a1-a0)*i/n) [cx+r*cos(a), cz+r*sin(a)]];

// preserved smooth research-optimized cross-section
module body2d(){
    polygon(concat(
        [[exit_r, z0], [throat_r0, z1], [throat_r0, z2]],
        arcpts(throat_r0+Rc, z2, Rc, 180, 90, 16),                     // Coandă turn
        [[throat_r0+Rc, z_top-top_r]],
        arcpts(throat_r0+Rc+top_r, z_top-top_r, top_r, 180, 90, 10),   // round top-inner
        arcpts(R-top_r, z_top-top_r, top_r, 90, 0, 10),                // round top-outer
        [[R, z2]],                                                    // outer wall straight down past the plenum floor (fixes the pinched-off ring)
        arcpts(R-bot_r, z2, bot_r, 0, -90, 10),                       // round ring bottom (now below the plenum)
        [[throat_r0+wall+7, z1+1.5]],
        [[throat_r0+wall, z1]],
        [[exit_r+wall, z0]]
    ));
}
module plenum2d(){
    polygon([[throat_r0+Rc+wall, z2+1],[R-wall, z2+1],
             [R-wall, z_top-wall],[throat_r0+Rc+wall, z_top-wall]]);
}
// the full, clean, enclosed donut (no fragile slit cut)
module full_solid(){
    difference(){
        union(){
            rotate_extrude($fn=200) body2d();
            translate([r_neck,0,z_top-2]) cylinder(d=sock_bore+2*sock_wall, h=neck_len);
        }
        rotate_extrude($fn=200) plenum2d();
        translate([r_neck,0,z_top-1]) cylinder(d=sock_bore, h=neck_len+2);
        translate([r_neck,0,z2+1]) cylinder(d=16, h=z_top-z2);  // near-full-size feed (was 10)
    }
}

module below(z){ translate([0,0,z-100]) cylinder(r=R+6, h=100); }
module above(z){ translate([0,0,z]) cylinder(r=R+6, h=100); }
module lip_ring(){                        // outer alignment lip (on bottom piece)
    difference(){ cylinder(r=R+1, h=reg_h); cylinder(r=R-wall-0.35, h=reg_h+1); }
}

module bottom_half(){
    intersection(){ full_solid(); below(split_z); }
}
module top_half(){
    difference(){
        intersection(){ full_solid(); above(split_z); }
        // slit recess on the inner edge -> the built-in slit gap
        translate([0,0,split_z-0.01])
            difference(){ cylinder(r=throat_r0+Rc+wall+0.5, h=slit_width);
                          cylinder(r=throat_r0+Rc-1, h=slit_width); }
    }
}

if      (part=="bottom") bottom_half();
else if (part=="top")    top_half();
else { bottom_half(); top_half(); }       // assembled preview (slit gap built in)
