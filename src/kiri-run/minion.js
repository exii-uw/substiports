/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

// dep: moto.license
// dep: geo.base
// dep: geo.polygons
// dep: geo.slicer
// dep: geo.wasm
// dep: kiri.codec
// dep: kiri-mode.fdm.post
// dep: ext.clip2
// use: kiri.pso
gapp.register("kiri-run.minion", [], (root, exports) => {

const { base, kiri } = root;
const { polygons } = base;
const { codec, Optimizer } = kiri;

const POLY = polygons;
const clib = self.ClipperLib;
const ctyp = clib.ClipType;
const ptyp = clib.PolyType;
const cfil = clib.PolyFillType;

let name = "unknown";

// catch clipper alerts and convert to console messages
self.alert = function(o) {
    console.log(o);
};

self.onmessage = function(msg) {
    let data = msg.data;
    let cmd = data.cmd;
    (funcs[cmd] || funcs.bad)(data, data.seq);
};

function reply(msg, direct) {
    self.postMessage(msg, direct);
}

function log() {
    console.log(`[${name}]`, ...arguments);
}

const funcs = {
    label(data, seq) {
        name = data.name;
    },

    config: data => {
        if (data.base) {
            Object.assign(base.config, data.base);
        } else {
            log({invalid: data});
        }
    },

    union: (data, seq) => {
        if (!(data.polys && data.polys.length)) {
            reply({ seq, union: codec.encode([]) });
            return;
        }
        let polys = codec.decode(data.polys);
        let union = POLY.union(polys, data.minarea || 0, true);
        reply({ seq, union: codec.encode(union) });
    },

    topShells: (data, seq) => {
        let top = codec.decode(data.top, {full: true});
        let {z, count, offset1, offsetN, fillOffset, opt} = data;
        kiri.driver.FDM.doTopShells(z, top, count, offset1, offsetN, fillOffset, opt);
        reply({ seq, top: codec.encode(top, {full: true}) });
    },

    fill: (data, seq) => {
        let polys = codec.decode(data.polys);
        let { angle, spacing, minLen, maxLen } = data;
        let fill = POLY.fillArea(polys, angle, spacing, [], minLen, maxLen);
        let arr = new Float32Array(fill.length * 4);
        for (let i=0, p=0; p<fill.length; ) {
            let pt = fill[p++];
            arr[i++] = pt.x;
            arr[i++] = pt.y;
            arr[i++] = pt.z;
            arr[i++] = pt.index;
        }
        reply({ seq, fill: arr }, [ arr.buffer ]);
    },

    clip: (data, seq) => {
        let clip = new clib.Clipper();
        let ctre = new clib.PolyTree();
        let clips = [];

        clip.AddPaths(data.lines, ptyp.ptSubject, false);
        clip.AddPaths(data.polys, ptyp.ptClip, true);

        if (clip.Execute(ctyp.ctIntersection, ctre, cfil.pftNonZero, cfil.pftEvenOdd)) {
            for (let node of ctre.m_AllPolys) {
                clips.push(codec.encode(POLY.fromClipperNode(node, data.z)));
            }
        }

        reply({ seq, clips });
    },

    sliceZ: (data, seq) => {
        let { z, points, options } = data;
        let i = 0, p = 0, realp = new Array(points.length / 3);
        while (i < points.length) {
            realp[p++] = base.newPoint(points[i++], points[i++], points[i++]).round(3);
        }
        let output = [];
        base.sliceZ(z, realp, {
            ...options,
            each(out) { output.push(out) }
        }).then(() => {
            for (let rec of output) {
                // lines do not pass codec properly (for now)
                delete rec.lines;
            }
            reply({ seq, output: codec.encode(output) });
        });
    },

    wasm: data => {
        if (data.enable) {
            base.wasm_ctrl.enable();
        } else {
            base.wasm_ctrl.disable();
        }
    },

    test: (data, seq) => {
        console.log({minion_data:data});
        console.log({minion_data:data});
        let { number, coded_slice, slice2, two_list, topList } = data;
        console.log({two_list:two_list});
        let slice3 = codec.decode(data.coded_slice, {full: true});
        let slice4 = codec.encode(slice3);
        let out = [];
        // let outtop = codec.decode(data.coded_tops[0], {full: true});
        let topFromList = topList[0];
        // console.log({outtop:outtop});
        
        let outkiritop = codec.decode(topFromList);
        console.log({outkiritop:outkiritop});
        let outtop = outkiritop;
        out.push(number*100);
        out.push(data.number*100);
        reply({ seq, output: out, coded_slice, slice2, slice3, slice4, outtop });
    },

    surrogateClusterSearch: (data, seq) => {
        var optimizer = new kiri.Optimizer();
        let { slice_stack_data, surrogate_library, support_points, susu_settings } = data;
        console.log({slice_stack_data:slice_stack_data});
        console.log({surrogate_library:surrogate_library});
        console.log({support_points:support_points});
        console.log({susu_settings:susu_settings});
        let mock_slice_list = [];
        for (let slice_data of slice_stack_data) {
            let mock_slice = codec.decode(slice_data[0]);
            mock_slice.supports = [];

            for (let oneTop of slice_data[1]) {
                mock_slice.tops.push(codec.decode(oneTop, {full: true}));
            }
            for (let oneSupport of slice_data[2]) {
                mock_slice.supports.push(codec.decode(oneSupport, {full: true}));
            }
            mock_slice_list.push(mock_slice);
        }

        let last_mock_slice;
        for (let mock_slice of mock_slice_list) {
            if (last_mock_slice) {
                mock_slice.down = last_mock_slice;
                last_mock_slice.up = mock_slice;
            }
            last_mock_slice = mock_slice;

        }
        console.log({mock_slice_list:mock_slice_list});
        let number_mock_slices = mock_slice_list.length;

        reply({ seq, output:number_mock_slices });
    },

    bad: (data, seq) => {
        reply({ seq, error: "invalid command" });
    }
};

});
