// ============================================================
//  LUCIDITY — Core + Lift-Stand Test Kit  (v3: sealed wing interface)
//  Cantilever-over-the-bench-edge layout. Air blows DOWN,
//  lift pushes UP, load cell reads the weight drop.
//  Set `part`, press F6, then File > Export > Export as STL.
//  Units: mm.  Material: standard PLA.
// ============================================================

// ---------- WHICH PART TO RENDER ----------
//  "clamp"  -> clamps the load-cell fixed end to the bench
//  "arm"    -> mounting arm: bolts to load-cell free end, holds core
//  "core"   -> manifold: blower on top, 4 sealed outlets pointing DOWN
//  "cap"    -> blanking cap for an outlet (per-outlet balance tests)
//  "coupon" -> tiny fit test: one outlet stub + one wing socket.
//              PRINT THIS FIRST to dial in the fit before full parts.
part = "core";

// ---------- ★ THE WING INTERFACE ★ (core & every wing share this) ----------
iface_od    = 28;   // outlet stub OUTER dia — the wing socket slides over this
iface_bore  = 22;   // through-bore (air path)
iface_len   = 16;   // engagement length (stub projects this far below core)
iface_fit   = 0.30; // wing-socket clearance. Slip = 0.30, tight press = 0.12
shoulder_od = 34;   // seating step the wing bottoms against (depth stop + seal)
shoulder_th = 3;

// ---------- LOAD CELL  (★ MEASURE YOURS & EDIT ★) ----------
lc_w       = 12.7;  lc_thk = 12.7;
lc_hole_d  = 5.2;   // M5 = 5.2, M4 = 4.5
lc_hole_in = 6;

// ---------- BLOWER  (★ MEASURE WS7040 OUTLET & EDIT ★) ----------
inlet_d    = 40;    inlet_wall = 3;

// ---------- PLENUM ----------
plenum_id  = 70;    wall = 3;   plenum_h = 80;
outlet_n   = 4;
outlet_pcd = 44;    // bolt-circle the 4 downward outlets sit on

// ---------- MOUNT ----------
flange_od  = plenum_id + 2*wall + 20;
flange_th  = 4;   flange_z = 46;
fit        = 0.4;
arm_len    = 130; arm_w = 22;  arm_th = 8;

plenum_od  = plenum_id + 2*wall;
$fn = 96;

// ============================================================
//  reusable: one downward outlet stub with sealing shoulder
//  (base of core is z=0; stub grows downward)
module outlet_stub(){
    difference(){
        union(){
            translate([0,0,-shoulder_th]) cylinder(d=shoulder_od, h=shoulder_th); // shoulder
            translate([0,0,-iface_len])   cylinder(d=iface_od,    h=iface_len);    // stub
        }
        translate([0,0,-iface_len-1]) cylinder(d=iface_bore, h=iface_len+wall+2);  // bore
    }
}

//  reusable: the socket that lives on a wing's inlet (slides over a stub)
module wing_socket(){
    difference(){
        cylinder(d=iface_od + iface_fit + 2*wall, h=iface_len);
        translate([0,0,-1]) cylinder(d=iface_od + iface_fit, h=iface_len - 2 + 1); // seat depth
        translate([0,0,-1]) cylinder(d=iface_bore, h=iface_len + 2);               // throat
    }
}

// ============================================================
module stand_clamp(){
    bw = lc_w + 16;  bl = 45;  h = 18;
    difference(){
        union(){
            translate([-bl/2, -bw/2, 0]) cube([bl, bw, h]);
            translate([-bl/2, -bw/2, h]) cube([bl, (bw-lc_w)/2, lc_thk]);
            translate([-bl/2,  lc_w/2, h]) cube([bl, (bw-lc_w)/2, lc_thk]);
        }
        translate([-bl/2 + lc_hole_in, 0, -1]) cylinder(d=lc_hole_d, h=h + lc_thk + 2);
    }
}

module mount_arm(){
    collar_od = flange_od + 10;
    difference(){
        union(){
            cylinder(d=collar_od, h=arm_th);
            translate([0, -arm_w/2, 0]) cube([arm_len, arm_w, arm_th]);
            translate([arm_len-2, -arm_w/2, 0]) cube([14, arm_w, arm_th]);
        }
        cylinder(d=plenum_od + fit, h=arm_th + 1);
        translate([arm_len + 4, 0, -1]) cylinder(d=lc_hole_d, h=arm_th + 2);
    }
}

module test_core(){
    difference(){
        union(){
            cylinder(d=plenum_od, h=plenum_h);
            translate([0,0,plenum_h]) cylinder(d=inlet_d + 2*inlet_wall, h=8);
            translate([0,0,flange_z]) cylinder(d=flange_od, h=flange_th);
            for(i=[0:outlet_n-1]) rotate([0,0,i*360/outlet_n])
                translate([outlet_pcd/2, 0, 0]) outlet_stub();
        }
        translate([0,0,wall]) cylinder(d=plenum_id, h=plenum_h - 2*wall);
        translate([0,0,plenum_h - wall - 1]) cylinder(d=inlet_d, h=wall + 8 + 2);
    }
}

module outlet_cap(){
    sock_id = iface_od + iface_fit;
    difference(){
        cylinder(d=sock_id + 2*wall, h=iface_len);
        translate([0,0,-0.1]) cylinder(d=sock_id, h=iface_len - 3);   // 3 mm closed end
    }
}

// fit test: a stub (like the core's) + a wing socket, printed side by side
module fit_coupon(){
    translate([-24,0,shoulder_th]){
        difference(){                       // stub on a little base pad
            union(){
                cylinder(d=shoulder_od+6, h=3);
                translate([0,0,3]) outlet_stub_up();
            }
            translate([0,0,-1]) cylinder(d=iface_bore, h=iface_len+8);
        }
    }
    translate([24,0,0]) wing_socket();
}
// stub drawn growing UPWARD for the coupon
module outlet_stub_up(){
    union(){
        cylinder(d=shoulder_od, h=shoulder_th);
        cylinder(d=iface_od, h=iface_len);
    }
}

// ---------- render selector ----------
if      (part == "clamp")  stand_clamp();
else if (part == "arm")    mount_arm();
else if (part == "core")   test_core();
else if (part == "cap")    outlet_cap();
else if (part == "coupon") fit_coupon();
