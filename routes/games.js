require('dotenv').config();
var express = require('express');
var router = express.Router();
var knex = require('../db/knex');
var enums = require('../lib/enums');
var helpers = require('../lib/helpers');
var multer  = require('multer');
var upload = multer({ dest: 'upfiles/' });
var del = require('del');
var cloudinary = require('cloudinary');
var moment = require('moment');
var query = require('../lib/query_user');


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


// require registered user to access
router.use(function(req,res,next){
  next();
});


router.get('/', function(req, res, next) {
  // TODO make this query more customized - ie get user name, etc
  knex('games')
  .select('id','dtcreated','hostuserid','title','dtstart','dtend')
  .orderBy('id','desc')
  .then(function(data){
    // pass moment functions to view
    res.render('games/listing', { siteSection: 'game', title: 'Games',
      rows: data, moment: moment });
  })
  .catch(function(err){
    next(err);
  })
});


router.get('/new', function(req, res, next) {
  res.render('games/new', { siteSection: 'game', title: 'Games' });
});

router.post('/new', upload.any(), function(req, res, next) {

  // verify input
  var _title = req.body.title.trim();
  var _tempDestination = (req.files && req.files[0] && req.files[0].path) ? req.files[0].path : '';
  var _startdate = req.body.startdate;
  var _startdatewithtime = _startdate + ' 08:00:00';
  var _gameStart= new Date(_startdatewithtime);
  var _now = new Date();

  var _errors = [];

  // TODO complete validation
  if(_title.length === 0){
    _errors.push('Title is required');
  }
  if(_tempDestination.length === 0){
    _errors.push('Image is required');
  }
  if(_startdate.length === 0){
    _errors.push('StartDate is required');
  }
  if(_gameStart < _now){
    _errors.push('StartDate must be in future');
  }

  // return on error
  if(_errors.length > 0){
    // console.log('signup errors: ', _errors);
    res.render('games/new', { siteSection: 'games', title: 'Games', error: _errors });
  } else {

    var _gameEnd = new Date(_gameStart);
    _gameEnd.setDate(_gameEnd.getDate() + 3);

    cloudinary.uploader.upload(
      _tempDestination,
      function(result) {

        knex('games')
        .insert({
          hostuserid: parseInt(req.session.user.id),
          title: _title,
          imageurl: result.url,
          dtstart: _gameStart,
          dtend: _gameEnd
        })
        .returning('id')
        .then(function(id) {

          // log event
          knex('gameevents')
          .insert({
            status: enums.eventStatus[1],
            gameid: parseInt(id),
            eventverb: 'gameCreated',
            newvalue: _title,
            description: 'startDate: ' + _gameStart + '// endDate: ' + _gameEnd,
            ipaddress: req.connection.remoteAddress
          })
          .then(function(){
            console.log('pre file delete');
            del([_tempDestination]);

            res.redirect('/games');
          })
          .catch(function(err){
            next(err);
          });
        })
        .catch(function(err){
          next(err);
        });
      },
      {
        crop: 'fit',
        width: 1500,
        height: 900
      }
    );
  }
});


router.get('/:id', function(req, res, next){

  var _game, _players, _events;
  var _userplayers = [];

  knex('games')
  .where({ id: parseInt(req.params.id) })
  .first()
  .then(function(game){
    // console.log('GAME', game);
    _game = game;
    return knex.select('*')
      .from('players')
      .where({ gameid: _game.id });
  })
  .then(function(playerIds){
    var playerPromises = [];
    for(var i=0;i<playerIds.length;i++){
      playerPromises.push(
        query.getUserPlayer_ByPlayerId(playerIds[i].id));
    }
    return Promise.all(playerPromises);
  })
  .then(function(userPlayers){
    var targetPromises = [];
    for(var i=0;i<userPlayers.length;i++){
      _userplayers.push(userPlayers[i].rows[0]);
      targetPromises.push(
        query.getUserPlayer_ByPlayerId(userPlayers[i].rows[0].targetplayer_id)
      );
    }
    return Promise.all(targetPromises);
  })
  .then(function(targetPlayers){
    var _targetPlayers = [];
    for(var i=0;i<targetPlayers.length;i++){
      _targetPlayers.push(targetPlayers[i].rows[0]);
    }

    // now match userplayers to targets and add in info for targets
    // console.log('TARGETS', _targetPlayers);
    for(var i=0;i<_userplayers.length;i++){
      var targetIdx = _userplayers[i].targetplayer_id;
      //console.log('tidx',targetIdx);
      // console.log('TARGETS', _targetPlayers);
      var target;
      if(targetIdx){
        // console.log('yes');
        target = _targetPlayers.find(function(e, i, ar){

          if(e.player_id === targetIdx){
            return e;
          }
        });
      }
      // console.log('target',target);
      _userplayers[i].targetplayer_image = (target) ? target.imageurl : '';
      _userplayers[i].targetplayer_lastlocation = (target) ? target.lastlocation : '';
    }

    // console.log('HUNTERS', _userplayers);


    knex('gameevents')
      .where({ gameid: _game.id })
      .orderBy('id', 'desc');
  })
  .then(function(_events){
    res.render('games/edit', { siteSection: 'games', title: 'Games',
      game: _game, players: _userplayers, events: _events, moment: moment });
  })
  .catch(function(err){
    next(err);
  });
});

// will add up to ten players
router.get('/:gameid/seedgame', function(req,res,next){
  var _gameid = parseInt(req.params.gameid);

  // clear out game events
  knex('gameevents').del()
  .where({gameid:_gameid})
  .then(function(ge){
    console.log('active players deleted');

    // delete any active players and players from game
    knex('activeplayers').del()
    .then(function(ap){
      console.log('active players deleted');

      knex('players').del()
      .then(function(pp){
        console.log('active players deleted');
        // generate up to ten users
        knex.select('*')
        .from('users')
        .limit(10)
        .then(function(rows) {
          // console.log('user list length', rows.length);

          var seedLocations = [
            {"lat":"40.0179359","lng":"-105.28214609999998"},
            {"lat":"40.0177793","lng":"-105.28199989999998"},
            {"lat":"40.0133969","lng":"-105.27723759999998"},
            {"lat":"40.0126173","lng":"-105.28073389999998"},
            {"lat":"40.0177793","lng":"-105.28199989999998"},
            {"lat":"40.0177883","lng":"-105.28199989999998"},
            {"lat":"40.0179121","lng":"-105.27822999999998"},
            {"lat":"40.0095857","lng":"-105.28280889999998"},
            {"lat":"40.0177793","lng":"-105.28100989999998"},
            {"lat":"39.9973033","lng":"-105.27414869999998"},
            {"lat":"40.0644673","lng":"-105.28373899999981"}
          ];

          //shuffle the seedLocations
          var shuffSeeds = helpers.shuffle(seedLocations);
          var shuffRows = helpers.shuffle(rows);


          // first create players to insert
          var ins = [];
          for(var i=0;i<shuffRows.length;i++){
            var row = shuffRows[i];
            ins.push({userid:row.id, gameid: _gameid, lastlocation:shuffSeeds[i]});
          }

          // console.log('here is array of users to insert', ins);

          // insert players
          //TODO ensure that there are no dupes
          knex.insert(ins)
          .into('players')
          .returning('id')
          .then(function(ids){

            console.log('inserted players ids', ids);
            // randomize the player list
            var rando = helpers.shuffle(ids);
            var acts = [];
            for(var i=0;i<ids.length;i++){
              var current = ids[i];
              //handle the end case
              var next = (i===(ids.length-1)) ? ids[0] : ids[i+1];
              acts.push({gameid:_gameid, playerid:current, targetid:next});
            }

            knex.insert(acts, 'id')
            .into('activeplayers')
            .then(function(actives){

              console.log('inserted activeplayers', actives);
              res.redirect('/games/' + _gameid);
            })
            .catch(function(err){
                next(err);
            });
          })
          .catch(function(err){
              next(err);
          });
        })
        .catch(function(err) {
          next(err);
        });
      })
      .catch(function(err) {
        next(err);
      });
    })
    .catch(function(err){
      next(err);
    });
  })
  .catch(function(err){
    next(err);
  });
});

// session user joins the game
router.get('/:gameid/join', function(req,res,next){

  var _playerid = req.session.user.id;
  var _gameid = parseInt(req.params.gameid);

  if(!_playerid || !_gameid){
    // this condition should not happen (in theory)
    next(err);
  } else {

    // console.log('join a game - play/game', _playerid, _gameid);
    // if the game does not have a player with this id then add to players
    knex('players')
    .where({ gameid: _gameid, userid: _playerid })
    .first()
    .then(function(data){

      if(data){
        // for now just go to game details
        console.log('user already exists as a player in tihs game');
        res.redirect('/games/' + _gameid);
      } else {
        //res.send('join a game');
        // NOTE location needs to be communicated by the client (maps api)
        //     //      so we don't record here. Be sure to handle (allow) players
        //     //      without location information
        knex('players')
        .insert({
          userid: _playerid,
          gameid: _gameid
        })
        .returning('id')
        .then(function(id) {
          id = Array.isArray(id) ? id[0] : id;
          knex('players')
          .where({ id: id })
          .first()
          .then(function(data){
            console.log('added player', data);
            req.session.player = data;
            res.redirect('/games/' + _gameid);
          })
          .catch(function(err){
            next(err);
          });
        })
        .catch(function(err){
          next(err);
        });
      }
    })
    .catch(function(err){
      next(err);
    });
  }
});



module.exports = router;
