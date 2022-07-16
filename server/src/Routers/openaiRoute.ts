// router setup
import express, { query } from "express";
const router = express.Router();

// import node modules and helpers
import { cleanup, writeFile, randomID } from "../helpers/helpers";

// impoort APIs
import { GoogleTTS } from "../helpers/gTTS";
import { config, GoogleSTT } from "../helpers/gSTT";
import { GoogleNLA, checkSentiment } from "../helpers/gNLA";
import {
  openai,
  chatPrompt,
  updatePrompt,
  standardPrompt,
} from "../helpers/openai";

const openaiRouter = (db: any): any => {
  ////////////////////////////////
  // Speech to Text Route
  ////////////////////////////////
  router.post("/speechToText", (req: any, res: any) => {
    console.log("SpeechToText endpoint received request");

    // frontend converted the audio blob into a base64 string, then we send it to Google STT api
    const request: {} = {
      audio: { content: req.body.base64.substring(23) },
      config,
    };

    console.log("firing to Google STT api");
    return GoogleSTT(request).then(([response]) => {
      // response will be an empty array if google cannot recognize anything
      if (!response.results[0]) {
        return res.send("Google could not recongize anything");
      } else {
        console.log(
          "received response from Google: ",
          response.results[0].alternatives[0].transcript
        );

        // saved this text to req.session
        req.session.recognizedText =
          response.results[0].alternatives[0].transcript;

        // redirect with code 307 will reserve the send method (i.e. POST method)
        res.redirect(307, "/api/openai/textToSpeech");
      }
    });
  });

  ////////////////////////////////
  // Text to Speech Route
  ////////////////////////////////
  router.post("/textToSpeech", (req: any, res: any) => {
    console.log("Session before clean up: ", req.session);
    cleanup(req.session);
    console.log("Session after clean up: ", req.session);

    console.log("TextToSpeech endpoint received request");
    console.log("req.session.recognizedText: ", req.session.recognizedText);
    console.log(
      "Current user session: ",
      req.session.userID,
      req.session.visitorID
    );

    // to deterentiate where the request was from speech or text
    req.session.requestedText = req.session.recognizedText
      ? req.session.recognizedText
      : req.body.message;

    // to make sure if the text is from registered user or visitor. If it is a visitor, then provide a visitorID
    if (!req.session.userID && !req.session.visitorID) {
      console.log("Initializing visitor ID...");
      req.session.visitorID = randomID();
    }

    // to check if this is a new conversation for a user. If so, write to db to create a new conversation
    if (req.session.userID && !req.session.convoID) {
      console.log(
        "user session exists but does not have convoID. Creating conversation now."
      );
      db.conversation
        .create({
          user_id: req.session.userID,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .then((response: any) => {
          console.log("convoID created: ", response.id);
          req.session.convoID = response.id;
        })
        .then(() => {
          db.message
            .create({
              content: req.session.requestedText,
              conversation_id: req.session.convoID,
              from_bot: false,
              createdAt: new Date(),
            })
            .then((response: any) =>
              console.log("User input has been written to db")
            )
            .catch((err: any) => console.error(err));
        });
    }

    // when both userID and convoID exists, directly write to db.message
    if (req.session.userID && req.session.convoID) {
      console.log(
        "Both user session and convoID exist. Writing user input now."
      );
      db.message
        .create({
          content: req.session.requestedText,
          conversation_id: req.session.convoID,
          from_bot: false,
          createdAt: new Date(),
        })
        .then((response: any) =>
          console.log("User input has been written to db")
        )
        .catch((err: any) => console.error(err));
    }

    console.log("Proceeding to GoogleNLA...");

    // first send the text off to Google NLA
    return GoogleNLA(req.session.requestedText)
      .then((response: any) => {
        req.session.requestedSentiment = checkSentiment(
          response[0].documentSentiment.score
        );
        console.log(
          "Google NLA says the speaker's sentiment is ",
          req.session.requestedSentiment,
          response[0].documentSentiment.score
        );

        // visitor will get a none saved prompt every time

        if (req.session.visitorID) {
          return openai.createCompletion(
            chatPrompt(
              req.session.requestedText,
              req.session.requestedSentiment
            )
          );
        }

        // if the above conditional didn't run, it means user is logged in. search for prompt history in db
        return db.prompt
          .findOne({
            where: {
              user_id: req.session.userID,
              conversation_id: req.session.convoID,
            },
          })
          .then((response: any) => {
            if (response) {
              // there was prompt history created, simply insert the prompt history and proceed
              req.session.promptID = response.id;
              // reassigning new prompt with prompt history
              console.log(
                "db prompt search returns a prompt history.",
                response.prompt
              );
              console.log(
                " Now we send this off to google: ",
                chatPrompt(
                  req.session.requestedText,
                  req.session.requestedSentiment,
                  response.prompt
                )
              );
              return openai.createCompletion(
                chatPrompt(
                  req.session.requestedText,
                  req.session.requestedSentiment,
                  response.prompt
                )
              );
            } else {
              // since no response, we create a new boiler-plate prompt
              console.log(
                "db prompt search returns nothing,creating new boiler-plate prompt..."
              );
              let boilerPlate = chatPrompt(
                req.session.requestedText,
                req.session.requestedSentiment
              );

              console.log("boilerPlate is: ", boilerPlate);

              // perform a database upsert first then proceed. This will save some time for later prompt update search
              return db.prompt
                .upsert({
                  user_id: req.session.userID,
                  conversation_id: req.session.convoID,
                  prompt: standardPrompt,
                })
                .then((response: any) => {
                  console.log("After boilerPlate upsert: ", response);
                  console.log("boilerPlate completed, proceeding...");
                  req.session.promptID = response[0].id;
                  return openai.createCompletion(boilerPlate);
                });
            }
          });
      })
      .then((response: any) => {
        // once the response from openai is back, we pass it to NLA again
        console.log("OPEN AI: ", response.data);

        // save the audioID for saving and retrieving the file. Based on different results, the prefix of audioID would be different
        req.session.audioID = req.session.userID
          ? `${req.session.userID}-${response.data.id}`
          : `${req.session.visitorID}-${response.data.id}`;

        req.session.respondedText = response.data.choices[0].text.trim();

        return GoogleNLA(req.session.respondedText);
      })
      .then((response: any) => {
        req.session.respondedSentiment = checkSentiment(
          response[0].documentSentiment.score
        );
        console.log(
          "responded sentiment is",
          req.session.respondedSentiment,
          response[0].documentSentiment.score
        );

        // update promptHistory, so that gpt-3 will have history and can recall if we ask the same question
        if (req.session.userID) {
          db.prompt
            .findOne({
              where: {
                user_id: req.session.userID,
                conversation_id: req.session.convoID,
              },
            })
            .then((response: any) => {
              db.prompt.upsert({
                id: req.session.promptID,
                prompt: updatePrompt(
                  response.prompt,
                  req.session.requestedText,
                  req.session.requestedSentiment,
                  req.session.respondedText,
                  req.session.respondedSentiment
                ),
                user_id: req.session.userID,
                conversation_id: req.session.convoID,
              });
            })
            .then((response: any) => {
              console.log("Update prompt completed: ");
            });
        }

        // choose voice based on character gender. FEMALE voice is used by default.
        return req.body.gender
          ? GoogleTTS(req.session.respondedText, req.body.gender)
          : GoogleTTS(req.session.respondedText);
      })
      .then(([response]: any[]) => {
        // Base64 encoding is done, time to write file
        console.log("decoded stage finished: ", response.audioContent);
        // stretch: write a cron job script to periodically clean up the audio files
        return writeFile(
          `./src/audio/${req.session.audioID}.mp3`,
          response.audioContent,
          "binary"
        );
      })
      .then(() => {
        // this is will send response back to frontend, which react will update it's dom to retrieve new audio file and initiate character animation
        console.log("preparing data for front-end");
        let apiResponse: object = {
          gender: req.session.gender || "FEMALE",
          userID: req.session.userID,
          audioID: req.session.audioID,
          requestedText: req.session.requestedText,
          aiSentiment: req.session.respondedSentiment,
          aiText: req.session.respondedText,
        };

        // clear any speech to text record
        req.session.recognizedText = null;

        console.log(
          "Session before sending off response to front-end: ",
          req.session
        );

        // if it is a visitor, no need to write to db. However, if it is a user, write to db
        if (req.session.visitorID) {
          console.log("Supposedly visitor session here", req.session);
          res.status(200).json(apiResponse);
        } else {
          return db.message
            .create({
              content: req.session.respondedText,
              conversation_id: req.session.convoID,
              from_bot: true,
              createdAt: new Date(),
            })
            .then((response: any) => {
              console.log("AI message written to db", response);
              console.log("Retrieving chat history...");
              db.message
                .findAll({
                  include: [
                    {
                      model: db.conversation,
                      where: { user_id: req.session.userID },
                      required: true,
                    },
                  ],
                })
                .then((response: any) => {
                  apiResponse = {
                    ...apiResponse,
                    convoID: req.session.convoID,
                    chatHistory: response,
                  };
                  console.log("I am at the very bottom here.", req.session);
                  res.status(200).json(apiResponse);
                });
            });
        }
      });
  });

  return router;
};

export default openaiRouter;
