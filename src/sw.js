importScripts('/js/idb.min.js');

let version = '1.4.0';

let staticCacheName = 'mws-rrs1-' + version;

/*
 * Creates indexDb Database
 */
function createDB() {
  idb.open('restaurants-reviews', 1, function (upgradeDB) {

    console.log("Creating Restaurant List Object Store");

    upgradeDB.createObjectStore('restaurants', {keyPath: 'id'});

    for (var i = 1; i <= 10; i++) {
      upgradeDB.createObjectStore('reviews-' + i, {keyPath: 'id'})
    }
  })
}

self.addEventListener('activate', event => {
  event.waitUntil(
    createDB()
  )
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('sync', function (event) {
  if (event.tag === 'outbox') {
    event.waitUntil(fetchReview()
      .then(() => {
        console.log("Successfully Synced")
      })
      .catch((error) => {
        console.log("Error syncing the reviews",error);
      })
    );
  }
});


function fetchReview() {

  // Opens indexDB
  return idb.open('review', 1)
    .then(function (db) {
      var transaction = db.transaction('outbox', 'readonly');
      return transaction.objectStore('outbox').getAll();
    }).then(function (reviews) {

      return Promise.all(reviews.map(function (review) {

        var reviewID = review.id;
        delete review.id;

        console.log("review inside promis", review);

        // Fetching request the review
        return fetch('http://localhost:1337/reviews', {
          method: 'POST',
          body: JSON.stringify(review),
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }).then(function (response) {
          console.log(response);
          return response.json();
        }).then(function (data) {

          console.log("Successfully Added data ", data);

          if (data) {
            idb.open('review', 1)
              .then(function (db) {
                var transaction = db.transaction('outbox', 'readwrite');
                return transaction.objectStore('outbox').delete(reviewID);
              })
          }
        })
      }))

    });
}

/*
 * Add data to Database
 */
function addAllToDB(storeName, items) {
  idb.open('restaurants-reviews', 1).then(function (db) {
    var tx = db.transaction(storeName, 'readwrite');
    var store = tx.objectStore(storeName);

    return Promise.all(items.map(function (item) {
        // console.log("Adding Item", item);
        return store.put(item);
      })
    ).then(function (e) {
      console.log("Added Successfully");
    }).catch(function (e) {
      tx.abort();
      console.log(e);
    })
  })
}

addEventListener('fetch', event => {
  // Prevent the default
  event.respondWith(async function () {

    if (checkForIndexDBRequest(event.request.url)) {
      var lastIndexOfSlash = event.request.url.lastIndexOf('/');

      var storeName = event.request.url.substring(lastIndexOfSlash + 1);

      if (storeName.lastIndexOf('restaurant_id') > 0) {
        storeName = 'reviews-' + storeName.substring(storeName.lastIndexOf('=') + 1);
      }
      // Open the indexDB database
      return idb.open('restaurants-reviews', 1).then(function (db) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        // Return items from database
        return store.getAll();
      }).then((rs) => {
        console.log("All Data From IndexDB", rs);
        if (!rs.length) {
          return fetch(event.request.url)
            .then((response) => {

              return response.json()
                .then(function (data) {
                  addAllToDB(storeName, data);
                  console.log('Saving to DB and responding from FETCH', data);

                  var init = {
                    status: 200,
                    statusText: "OK",
                    headers: {'Content-Type': 'application/jso'}
                  };

                  const fetchResponse = new Response(JSON.stringify(data), init);
                  return fetchResponse;
                })
            })
        } else {
          // Responding when data is available in cache
          console.log('Responding from IndexDB');

          var init = {
            status: 200,
            statusText: "OK",
            headers: {'Content-Type': 'application/jso'}
          };

          const indexDBResponse = new Response(JSON.stringify(rs), init);
          console.log("Response from indexDB to send to fetch ", rs);
          return indexDBResponse;
        }
      })
    } else {
      // Try to get the response from a cache.
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) {
        console.log('Found ', event.request.url, ' in cache');
        return cachedResponse;
      }
      // Otherwise use the netword
      return fetch(event.request)
        .then(function (cachedResponse) {
          return caches.open(staticCacheName).then(function (cache) {
            if (event.request.url.indexOf('maps') < 0) {
              console.log('Saving ' + event.request.url + ' into cache.');
              cache.put(event.request.url, cachedResponse.clone());
            }
            return cachedResponse;
          });
        });
    }
  }());
});


function checkForIndexDBRequest(str) {
  var r1 = /^http:\/\/localhost:1337\/restaurants$/;
  var r2 = /^http:\/\/localhost:1337\/reviews/;

  var m1 = str.match(r1);
  var m2 = str.match(r2);

  if (m1 || m2)
    return 1;

  return 0;

}

/* delete old cache */
self.addEventListener('activate', function (event) {
  console.log('Activating new service worker...');

  var cacheWhitelist = [staticCacheName];

  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.map(function (cacheName) {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

