
var EventEmitter = require('events').EventEmitter,
    MongoClient = require('mongodb').MongoClient,
    url = "mongodb://localhost:27017/Recordings";


MongoClient.connect(url, function(err, db) {
  if (err) throw err;
  console.log("Database created!");
  db.close();
});
