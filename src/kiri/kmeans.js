// var distances = require("./distance");

(function () {
   'use strict';

   if (self.kiri.kmeans) return;

   self.kiri.kmeans = {
      KMeans: KMeans

   };

   let KIRI = self.kiri,
      BASE = self.base,
      CONF = BASE.config,
      UTIL = BASE.util

   function KMeans(centroids) {
      this.centroids = centroids || [];
   }

   var distances = {
      euclidean: function(v1, v2) {
         var total = 0;
         // for (var i = 0; i < v1.length; i++) {
         //    total += Math.pow(v2[i] - v1[i], 2);      
         // }
         total += Math.pow(v2.x - v1.x, 2);
         total += Math.pow(v2.y - v1.y, 2);


         total += (Math.pow(v2.z - v1.z, 2)*0.5);
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

   KMeans.prototype.randomCentroids = function(points, k) {
      var centroids = points.slice(0); // copy
      centroids.sort(function() {
         return (Math.round(Math.random()) - 0.5);
      });
      return centroids.slice(0, k);
   }

   KMeans.prototype.classify = function(point, distance) {
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

   KMeans.prototype.cluster = function(points, k, distance, snapshotPeriod, snapshotCb) {
      k = k || Math.max(2, Math.ceil(Math.sqrt(points.length / 2)));

      distance = distance || "euclidean";
      if (typeof distance == "string") {
         distance = distances[distance];
      }

      this.centroids = this.randomCentroids(points, k);

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

   KMeans.prototype.toJSON = function() {
      return JSON.stringify(this.centroids);
   }

   KMeans.prototype.fromJSON = function(json) {
      this.centroids = JSON.parse(json);
      return this;
   }

   if (false) { // Node
      module.exports = KMeans;

      module.exports.kmeans = function(vectors, k) {
         return (new KMeans()).cluster(vectors, k);
      }
   }
})();