/**
 * Module dependencies.
 */
var express = require('express'),
  io = require('socket.io'),
  tweets = require('./routes/tweetlist'),
  http = require('http'),
  twitter = require('ntwitter'),
  cronJob = require('cron').CronJob,
  _ = require('underscore'),
  path = require('path'),
  mongo = require('mongodb'),
  monk = require('monk'),
  db = monk('localhost:27017/twitter-cashtag-heatmap'),
  tconfig = require('./tconfig.js');

//Create an express app
var app = express();

//Create the HTTP server with the express app as an argument
var server = http.createServer(app);

// Twitter symbols array
var watchSymbols = ['$msft', '$intc', '$hpq', '$goog', '$nok',
                  '$nvda', '$bac', '$orcl', '$csco', '$aapl',
                  '$ntap', '$emc', '$t', '$ibm', '$vz', '$xom',
                  '$cvx', '$ge', '$ko', '$jnj'];

//This structure will keep the total number of tweets received and a map of all the symbols and how many tweets received of that symbol
var watchList = {
    total: 0,
    symbols: {}
  };

//Set the watch symbols to zero.
_.each(watchSymbols, function (v) { watchList.symbols[v] = 0; });

//Generic Express setup
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(app.router);
app.use(require('stylus').middleware(__dirname + '/public'));
app.use(express.static(path.join(__dirname, 'public')));

//We're using bower components so add it to the path to make things easier
app.use('/components', express.static(path.join(__dirname, 'components')));

// development only
if ('development' === app.get('env')) {
  app.use(express.errorHandler());
}

//Our only route! Render it with the current watchList
app.get('/', function (req, res) {
  res.render('index', { data: watchList });
});

app.get('/tweetlist', tweets.tweetlist(db));

//Start a Socket.IO listen
var sockets = io.listen(server);

//Set the sockets.io configuration.
//THIS IS NECESSARY ONLY FOR HEROKU!
sockets.configure(function () {
  sockets.set('transports', ['xhr-polling']);
  sockets.set('polling duration', 10);
});

//If the client just connected, give them fresh data!
sockets.sockets.on('connection', function (socket) {
  socket.emit('data', watchList);
});

//Instantiate the twitter component
//You will need to get your own key. Don't worry, it's free. But I cannot provide you one
//since it will instantiate a connection on my behalf and will drop all other streaming connections.
//Check out: https://dev.twitter.com/
var t = new twitter(tconfig.config);

// //Tell the twitter API to filter on the watchSymbols 
t.stream('statuses/filter', { track: watchSymbols }, function (stream) {

  //We have a connection. Now watch the 'data' event for incomming tweets.
  stream.on('data', function (tweet) {

    //This variable is used to indicate whether a symbol was actually mentioned.
    //Since twitter doesnt why the tweet was forwarded we have to search through the text
    //and determine which symbol it was ment for. Sometimes we can't tell, in which case we don't
    //want to increment the total counter...
    var claimed = false;
    var claimedSymbol = "";

    // Set our collection
    var collection = db.get('tweetcollection');

    //Make sure it was a valid tweet
    if (tweet.text !== undefined) {

      //We're gunna do some indexOf comparisons and we want it to be case agnostic.
      var text = tweet.text.toLowerCase();
      console.log("TWEET: " + text);

      //Go through every symbol and see if it was mentioned. If so, increment its counter and
      //set the 'claimed' variable to true to indicate something was mentioned so we can increment
      //the 'total' counter!
      _.each(watchSymbols, function (v) {
        if (text.indexOf(v.toLowerCase()) !== -1) {
        //if(text.match(""+v+" " | " "+v+"." | ""+v+"." | " "+v+" "))
          watchList.symbols[v] += 1;
          claimed = true;
          claimedSymbol = v;
        }
      });

      //If something was mentioned, increment the total counter and send the update to all the clients
      if (claimed) {
      //Increment total
        watchList.total += 1;
        // Submit to the DB
        collection.insert({
          "tweet" : text,
          "symbol": claimedSymbol
        }, function (err, doc) {
          if (err) {
          // If it failed, return error
            console.log("DB ERROR: There was a problem adding the information to the database.");
          }
        });
        //Send to all the clients
        sockets.sockets.emit('data', watchList);
      }
    }
  });
});

//Reset everything on a new day!
//We don't want to keep data around from the previous day so reset everything.
new cronJob('0 0 0 * * *', function () {
//Reset the total
  watchList.total = 0;

  //Clear out everything in the map
  _.each(watchSymbols, function (v) { watchList.symbols[v] = 0; });

  //Send the update to the clients
  sockets.sockets.emit('data', watchList);
}, null, true);

//Create the server
server.listen(app.get('port'), function () {
  console.log('Express server listening on port ' + app.get('port'));
});
