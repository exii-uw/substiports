// var distances = require("./distance");

   
"use strict";

// dep: geo.base
gapp.register("kiri.kmeans", [], (root, exports) => {

const { base, kiri } = root;

var distances = {
   euclidean: function(v1, v2) {
      var total = 0;
      // for (var i = 0; i < v1.length; i++) {
      //    total += Math.pow(v2[i] - v1[i], 2);      
      // }
      // total += Math.pow(v2.x - v1.x, 2);
      // total += Math.pow(v2.y - v1.y, 2);
      // total += (Math.pow(v2.z - v1.z, 2)*0.5);
      total += Math.pow(v2[0] - v1[0], 2);
      total += Math.pow(v2[1] - v1[1], 2);
      total += (Math.pow(v2[2] - v1[2], 2)*0.25);
      return Math.sqrt(total);
   },
   manhattan: function(v1, v2) {
      var total = 0;
      for (var i = 0; i < v1.length ; i++) {
         total += Math.abs(v2[i] - v1[i]);      
      }
      return total;
   },
   max: function(v1, v2) {
      var max = 0;
      for (var i = 0; i < v1.length; i++) {
         max = Math.max(max , Math.abs(v2[i] - v1[i]));      
      }
      return max;
   }
}

class KMeans {

   constructor(centroids) {
      this.centroids = centroids || [];
   }

   /**
	 * K-means++ initial centroid selection
	 */
   kmpp = function(points, k, distance) {
      // var distance = fndist || (points[0].length? eudist : dist);
      var ks = [], len = points.length;
      var multi = points[0].length>0;
      var map = {};

      // First random centroid
      var c = points[Math.floor(Math.random()*len)];
      var key = multi? c.join("_") : `${c}`;
      ks.push(c);
      map[key] = true;

      // Retrieve next centroids
      while(ks.length < k) {
         // Min Distances between current centroids and data points
         let dists = [], lk = ks.length;
         let dsum = 0, prs = [];

         for(let i=0;i<len;i++) {
            let min = Infinity;
            for(let j=0;j<lk;j++) {
               let dist = distance(points[i],ks[j]);
               if(dist<=min) min = dist;
            }
            dists[i] = min;
         }

         // Sum all min distances
         for(let i=0; i<len; i++) {
            dsum += dists[i]
         }

         // Probabilities and cummulative prob (cumsum)
         for(let i=0; i<len; i++) {
            prs[i] = {i:i, v:points[i],	pr:dists[i]/dsum, cs:0}
         }

         // Sort Probabilities
         prs.sort((a,b)=>a.pr-b.pr);

         // Cummulative Probabilities
         prs[0].cs = prs[0].pr;
         for(let i=1; i < len; i++) {
            prs[i].cs = prs[i-1].cs + prs[i].pr;
         }

         // Randomize
         let rnd = Math.random();

         // Gets only the items whose cumsum >= rnd
         let idx = 0;
         while(idx < len-1 && prs[idx++].cs < rnd);
         ks.push(prs[idx-1].v);
         /*
         let done = false;
         while(!done) {
            // this is our new centroid
            c = prs[idx-1].v
            key = multi? c.join("_") : `${c}`;
            if(!map[key]) {
               map[key] = true;
               ks.push(c);
               done = true;
            }
            else {
               idx++;
            }
         }
         */
      }

      return ks;
   }

   // KMeans.prototype.calcMeanCentroid = function(dataSet, start, end) {
   //    const features = dataSet[0].length;
   //    const n = end - start;
   //    let mean = [];
   //    for (let i = 0; i < features; i++) {
   //      mean.push(0);
   //    }
   //    for (let i = start; i < end; i++) {
   //      for (let j = 0; j < features; j++) {
   //        mean[j] = mean[j] + dataSet[i][j] / n;
   //      }
   //    }
   //    return mean;
   // }

   // KMeans.prototype.getRandomCentroidsNaiveSharding = function(points, k) {
   //    // implementation of a variation of naive sharding centroid initialization method
   //    // (not using sums or sorting, just dividing into k shards and calc mean)
   //    // https://www.kdnuggets.com/2017/03/naive-sharding-centroid-initialization-method.html
   //    const numSamples = points.length;
   //    // Divide points into k shards:
   //    const step = Math.floor(numSamples / k);
   //    const centroids = [];
   //    for (let i = 0; i < k; i++) {
   //      const start = step * i;
   //      let end = step * (i + 1);
   //      if (i + 1 === k) {
   //        end = numSamples;
   //      }
   //      centroids.push(calcMeanCentroid(points, start, end));
   //    }
   //    return centroids;
   // }

   // KMeans.prototype.getRandomCentroids = function(points, k) {
   //    // selects random points as centroids from the pointset
   //    const numSamples = points.length;
   //    const centroidsIndex = [];
   //    let index;
   //    while (centroidsIndex.length < k) {
   //      index = randomBetween(0, numSamples);
   //      if (centroidsIndex.indexOf(index) === -1) {
   //        centroidsIndex.push(index);
   //      }
   //    }
   //    const centroids = [];
   //    for (let i = 0; i < centroidsIndex.length; i++) {
   //      const centroid = [...points[centroidsIndex[i]]];
   //      centroids.push(centroid);
   //    }
   //    return centroids;
   // }

   randomCentroids = function(points, k) {
      var centroids = points.slice(0); // copy
      centroids.sort(function() {
         return (Math.round(Math.random()) - 0.5);
      });
      return centroids.slice(0, k);
   }

   classify = function(point, distance) {
      var min = Infinity,
         index = 0;

      distance = distance || "euclidean";
      if (typeof distance == "string") {
         distance = distances[distance];
      }

      for (var i = 0; i < this.centroids.length; i++) {
         var dist = distance(point, this.centroids[i]);
         if (dist < min) {
            min = dist;
            index = i;
         }
      }

      return index;
   }

   cluster = function(points, k, distance, snapshotPeriod, snapshotCb) {
      k = k || Math.max(2, Math.ceil(Math.sqrt(points.length / 2)));

      distance = distance || "euclidean";
      if (typeof distance == "string") {
         distance = distances[distance];
      }

      // this.centroids = this.randomCentroids(points, k);
      this.centroids = this.kmpp(points, k, distance);
      // console.log({randomCentroids:this.centroids});
      // let betterCentroids = this.kmpp(points, k, distance);

      // console.log({betterCentroids:betterCentroids});

      var assignment = new Array(points.length);
      var clusters = new Array(k);

      var iterations = 0;
      var movement = true;
      while (movement) {
         // update point-to-centroid assignments
         for (var i = 0; i < points.length; i++) {
            assignment[i] = this.classify(points[i], distance);
         }

         // update location of each centroid
         movement = false;
         for (var j = 0; j < k; j++) {
            var assigned = [];
            for (var i = 0; i < assignment.length; i++) {
               if (assignment[i] == j) {
                  assigned.push(points[i]);
               }
            }

            if (!assigned.length) {
               continue;
            }

            var centroid = this.centroids[j];
            var newCentroid = new Array(centroid.length);

            for (var g = 0; g < centroid.length; g++) {
               var sum = 0;
               for (var i = 0; i < assigned.length; i++) {
                  sum += assigned[i][g];
               }
               newCentroid[g] = sum / assigned.length;

               if (newCentroid[g] != centroid[g]) {
                  movement = true;
               }
            }

            this.centroids[j] = newCentroid;
            clusters[j] = assigned;
         }

         if (snapshotCb && (iterations++ % snapshotPeriod == 0)) {
            snapshotCb(clusters);
         }
      }

      return clusters;
   }

   toJSON = function() {
      return JSON.stringify(this.centroids);
   }

   fromJSON = function(json) {
      this.centroids = JSON.parse(json);
      return this;
   }

}

function newKMeans(centroids) {
   return new KMeans(centroids);
}

gapp.overlay(kiri, {
   KMeans,
   newKMeans
});

// kiri.KMeans = KMeans;

});