/*
* GET tweetlist
*/

exports.tweetlist = function (db) {
	return function (req, res) {
		var collection = db.get('tweetcollection');
		collection.find({},{},function (e, docs) {
			res.render('tweetlist', {
            "tweetlist" : docs
        	});
    	});
	};
};