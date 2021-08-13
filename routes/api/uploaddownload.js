// This file exists to uncomplicate things
// All things related ti Grid-FS are in this file
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const config = require('config');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const auth = require('../../middleware/auth.js');

const Grid = require('gridfs-stream');
const GridFsStorage = require('multer-gridfs-storage');
const Composition = require('../../models/Composition');
const User = require('../../models/User');
const ObjectId = require('mongodb').ObjectID;

const conn = mongoose.connection;

module.exports = router => {

  let gfs;
  // Connect to the database

  conn.once('open', () => {
    // Init stream
    gfs = new mongoose.mongo.GridFSBucket(conn.db, {
      bucketName: 'uploads'
    });
  });
  
  // Define the storage of the database

  const storage = new GridFsStorage({
    url: config.get('mongoURI'),
    file: (req, file) => {
      return new Promise((resolve, reject) => {
        crypto.randomBytes(16, (err, buf) => {
          if (err) {
            return reject(err);
          }
          // Randomize the filename
          const filename = buf.toString('hex') + path.extname(file.originalname);
          // Add file to the bucket
          const fileInfo = {
            filename: filename,
            bucketName: 'uploads'
          };
          resolve(fileInfo);
        });
      });
    }
  });

  const upload = multer({ storage });

// @route    POST api/compositions/upload
// @desc     Upload mp3 information to the database
// @access   Server

  router.post('/upload', upload.single('file'), async (req, res) => {
    try {
      console.log(`Composition and file metadata are being written!`);

      const file = req.file;
      const data = JSON.parse(req.body.data);
      //console.log(data.user);
      const validUser = await User.findById(data.user).select('-password');

      let composition = await Composition.findById(data.composition.id);

      if (!composition) {
        res.status(404).send({ msg: "Composition not found." });
      }
      else if (!validUser || !validUser._id.equals(composition.user)) {
        res.status(401).send({ msg: "Not authorized to set comp. file metadata!" });
      }
      else {
        composition.composer = validUser.name;
        composition.runtime = data.composition.time;
        composition.file_id = file.id;
        composition.filelength = file.size;
        composition.filename = file.filename;
        composition.filetype = file.contentType;
        composition.performers = data.composition.performers;
      }

      await composition.save();
      console.log(`Composition saved successfully!`);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error while uploading composition file metadata.");
    }
  });

  // @route    GET api/compositions/view/:id
  // @desc     View a MP3 file
  // @access   Public

  router.get('/view/:id', async (req, res) => {
    console.log(`Viewing composition of ObjectID: ${JSON.stringify(req.params.id)}`);
    try {
      const composition = await Composition.findById(req.params.id);
      if (!composition) {
        return res.status(404).json({ msg: "Composition to view not found." });
      }
      const file = gfs.find({ _id: ObjectId(composition.file_id) })
        .toArray((err, files) => {
          if (!files || files.length === 0) {
            return res.status(404).json({
              err: "File not Found"
            });
          }
          gfs.openDownloadStream(ObjectId(composition.file_id)).pipe(res);
        });
    }
    catch (err) {
      console.error(err.message);
      res.status(500).send("Server error while retrieving composition for viewing.");
    }
  });

  // @route    DELETE api/compositions/remove/:id
  // @desc     Delete an mp3 from the database
  // @access   Private

  router.delete('/remove/:id', auth, async (req, res) => {
    try{
      const composition = await Composition.findById(req.params.id);
      if(!composition)
      {
        return res.status(404).json({ msg: "Composition not found"})
      }

      if(composition.user.toString() != req.user.id) {
        return res.status(401).json({ msg: 'User not autherized'});
      }
      const goaway = ObjectId(composition.file_id);
      // get rid of it
      gfs.delete(goaway);
      await composition.remove();
      res.json({success: true});
    }
    catch(err){
      console.error(err.message);
      res.status(500).send("Server error");
    }
  });

  // @route    DELETE api/compositions/removeuser
  // @desc     Delete a user along with all of their compositions
  // @access   Private
	
  router.delete('/removeuser', auth, async (req, res) => {
    try{
      const user = User.findById(req.user.id);

      // Check if user has any compositions
      test = await Composition.findOne({user: ObjectId(req.user.id)});
      if(test)
      {
      compositions = await Composition.find({user: ObjectId(req.user.id)}).sort({date: -1});
      while(compositions)
      {
	Delete every user composition that the user had made
        composition = await Composition.findOne({user: ObjectId(req.user.id)});
	if(!composition)
	  break;
        const goaway = ObjectId(composition.file_id);
        // get rid of it
        gfs.delete(goaway);
        await composition.remove();
      }

      }
      // Remove user after removing all of user's compositions.
      await User.findOneAndRemove({ _id: req.user.id });
      res.json({success: true});
    }catch(err){
        console.error(err.message);
        res.status(500).send("Server error while deleting composition.");
      }
  });
}

