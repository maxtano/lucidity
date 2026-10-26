// ============================================================
//  LUCIDITY — Wing v3  (correctly-sized THIN-SLIT Coandă ring)
//  ------------------------------------------------------------
//  THE FIX vs v2a: slit velocity is v = Q / A_slit, so a bigger
//  slit means a SLOWER jet. v2a's 201 mm^2 slit gave only ~30 m/s
//  -> almost no entrainment ("doesn't feel like it's sucking").
//
//  WS7040-24-V200 verified spec: 6.8 kPa, 22 m^3/h, outlet ID 12.
//  Max air-power point ~3.4 kPa -> slit velocity ~75 m/s
//     => A_slit ~ 41 mm^2   (v2a had 201 -> ~5x too big)
//
//  Achieved as a 0.3 mm GAP between two printed halves (a step
//  height, not a printed slot - that's why this is 2-piece).
//  Result: a much smaller, lighter ring (OD ~81 mm vs 108 mm).
//
//  slit_w sweep: 0.3 (~75 m/s) / 0.4 (~56 m/s) / 0.5 (~44 m/s)
//  part = "bottom" | "top" | "assembled"
// ============================================================

part   = "assembled";
slit_w = 0.3;      // <-- THE KEY DIAL (gap between halves)

slit_r    = 22;    // slit circle radius -> A_slit = 2*pi*slit_r*slit_w
Rc        = 4.5;   // Coandă turn radius (15x slit, top of research range,
                   //                     and printable at this scale)
throat_r0 = slit_r - Rc;      // 17.5 -> open center ~O35 mm
plenum_w  = 16;    // plenum cross-section >> slit area (feeds evenly)
plenum_h  = 12;
wall      = 2.5;
mix_len   = 6;     // cylindrical mixing throat
diff_len  = 12;    // diffuser
diff_ang  = 8;     // gentle half-angle
sock_bore = 17.4;  // blower spout grip (verified fit)
feed_bore = 12;    // = blower outlet ID, no restriction
sock_wall = 3;
neck_len  = 24;

R      = slit_r + plenum_w + wall;      // 40.5 -> OD 81 mm
exit_r = throat_r0 + diff_len*tan(diff_ang);
z0 = 0; z1 = diff_len; z2 = diff_len+mix_len; z3 = z2 + Rc;
z_top  = z3 + plenum_h + wall;
r_neck = slit_r + plenum_w/2 + wall/2;
top_r = 5; bot_r = 5;
split_z = z3;
$fn = 160;

echo(str(">> slit area = ", 2*3.14159*slit_r*slit_w, " mm^2   (target ~41)"));
echo(str(">> jet velocity ~ ", (22/3600)/(2*3.14159*slit_r*slit_w/1e6), " m/s"));

function arcpts(cx,cz,r,a0,a1,n=18) =
    [for(i=[0:n]) let(a=a0+(a1-a0)*i/n) [cx+r*cos(a), cz+r*sin(a)]];

module body2d(){
    polygon(concat(
        [[exit_r, z0], [throat_r0, z1], [throat_r0, z2]],
        arcpts(throat_r0+Rc, z2, Rc, 180, 90, 22),                 // Coandă turn
        [[slit_r, z_top-top_r]],
        arcpts(slit_r+top_r, z_top-top_r, top_r, 180, 90, 10),     // round top-inner
        arcpts(R-top_r, z_top-top_r, top_r, 90, 0, 10),            // round top-outer
        [[R, z2]],
        arcpts(R-bot_r, z2, bot_r, 0, -90, 10),                    // round ring bottom
        [[throat_r0+wall+6, z1+1.5]],
        [[throat_r0+wall, z1]],
        [[exit_r+wall, z0]]
    ));
}
module plenum2d(){
    polygon([[slit_r+wall, z2+1],[R-wall, z2+1],
             [R-wall, z_top-wall],[slit_r+wall, z_top-wall]]);
}
module full_solid(){
    difference(){
        union(){
            rotate_extrude($fn=220) body2d();
            translate([r_neck,0,z_top-2]) cylinder(d=sock_bore+2*sock_wall, h=neck_len);
        }
        rotate_extrude($fn=220) plenum2d();
        translate([r_neck,0,z_top-1]) cylinder(d=sock_bore, h=neck_len+2);  // spout grip
        translate([r_neck,0,z2+1])    cylinder(d=feed_bore, h=z_top-z2);    // feed to plenum
    }
}
module below(z){ translate([0,0,z-200]) cylinder(r=R+8, h=200); }
module above(z){ translate([0,0,z])     cylinder(r=R+8, h=200); }

module bottom_half(){ intersection(){ full_solid(); below(split_z); } }
module top_half(){
    difference(){
        intersection(){ full_solid(); above(split_z); }
        // recessed annular band -> becomes the slit gap when stacked
        translate([0,0,split_z-0.01])
            difference(){ cylinder(r=slit_r+wall+0.5, h=slit_w);
                          cylinder(r=slit_r-1.5,      h=slit_w); }
    }
}

if      (part=="bottom") bottom_half();
else if (part=="top")    top_half();
else { bottom_half(); top_half(); }
