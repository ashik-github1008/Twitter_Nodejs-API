const express = require('express')
const path = require('path')

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()

let db = null

app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

//register user //
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)
  if (password.length < 6) {
    response.status(400)
    response.send('Password is too short')
  } else {
    const hashedPassword = await bcrypt.hash(password, 10)
    if (dbUser === undefined) {
      const createUserQuery = `
      INSERT INTO 
        user (name,username, password, gender) 
      VALUES 
        (
          '${name}', 
          '${username}',
          '${hashedPassword}', 
          '${gender}'
        )`
      const dbResponse = await db.run(createUserQuery)
      response.status(200)
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('User already exists')
    }
  }
})

// login api //
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  let jwtToken
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'ashik')
      response.send({jwtToken: jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

// middle ware //
const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'ashik', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

// latest four tweets //

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const limit = 4
  const offset = 0
  const latestTweetQuery = `SELECT user.username,tweet.tweet,tweet.date_time AS dateTime
  FROM (user INNER JOIN tweet ON user.user_id = tweet.user_id) AS T INNER JOIN follower on follower.following_user_id = tweet.user_id
  WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username='${request.username}')
  ORDER BY tweet.date_time DESC
  LIMIT ${limit}
  OFFSET ${offset};`

  const tweet = await db.all(latestTweetQuery)
  response.send(tweet)
})

// following names //
app.get('/user/following/', authenticateToken, async (request, response) => {
  const followingQuery = `SELECT user.name  AS name FROM user INNER JOIN follower on user.user_id = follower.following_user_id
     WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username='${request.username}')`
  const followingPeople = await db.all(followingQuery)

  response.send(followingPeople)
})

// followers names //
app.get('/user/followers/', authenticateToken, async (request, response) => {
  console.log(request.username)
  const followersQuery = `
  SELECT user.name  AS name FROM user INNER JOIN follower on user.user_id = follower.follower_user_id
  WHERE follower.following_user_id = (SELECT user_id FROM user WHERE username='${request.username}')`
  const followerPeople = await db.all(followersQuery)

  response.send(followerPeople)
})

// following tweet middleware //
const followingTweetMiddleware = async (request, response, next) => {
  const {tweetId} = request.params
  const tweetCheckQuery = `SELECT tweet.tweet FROM (user INNER JOIN follower on user.user_id = follower.follower_user_id) AS T
  INNER JOIN tweet on tweet.user_id = T.following_user_id
  WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username='${request.username}') AND tweet.tweet_id = ${tweetId}`

  const tweetCheck = await db.get(tweetCheckQuery)

  if (tweetCheck === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

// following tweets //
app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  followingTweetMiddleware,
  async (request, response) => {
    const {tweetId} = request.params
    const resultQuery = `
        SELECT 
          tweet.tweet,
          COUNT(like.like_id) AS likes,
          COUNT(reply.reply_id) AS replies,
          tweet.date_time AS dateTime 
        FROM 
          tweet
        LEFT JOIN 
          like ON tweet.tweet_id=like.tweet_id
        LEFT JOIN 
          reply ON tweet.tweet_id=reply.tweet_id
        WHERE 
          tweet.tweet_id=${tweetId}
        GROUP BY tweet.tweet;`

    const result = await db.get(resultQuery)
    response.send(result)
  },
)

//likes //
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  followingTweetMiddleware,
  async (request, response) => {
    const {tweetId} = request.params
    const getLikesQuery = `
       SELECT user.username
       FROM like
       INNER JOIN user ON like.user_id = user.user_id
       WHERE like.tweet_id = ${tweetId};
     `

    const likesArray = await db.all(getLikesQuery)

    const usernamesArray = likesArray.map(like => like.username)

    response.send({likes: usernamesArray})
  },
)

// tweet replies //
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  followingTweetMiddleware,
  async (request, response) => {
    const {tweetId} = request.params
    const getRepliesQuery = `
       SELECT user.name,reply.reply
       FROM reply
       INNER JOIN user ON reply.user_id = user.user_id
       WHERE reply.tweet_id = ${tweetId};`

    const repliesArray = await db.all(getRepliesQuery)
    const namesRepliesArray = repliesArray.map(reply => ({
      name: reply.name,
      reply: reply.reply,
    }))
    response.send({replies: namesRepliesArray})
  },
)

// all tweets of user //
app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const tweetsQuery = `SELECT tweet.tweet, COUNT(like.like_id) AS likes, COUNT(reply.reply_id) AS replies, tweet.date_time AS dateTime 
  FROM tweet LEFT JOIN reply on tweet.tweet_id = reply.tweet_id 
  LEFT JOIN like on tweet.tweet_id = like.tweet_id
  WHERE tweet.user_id = (SELECT user_id FROM user WHERE username='${request.username}')
  GROUP BY tweet.tweet;`

  const tweetsResponse = await db.all(tweetsQuery)
  response.send(tweetsResponse)
})

// create a tweet //
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const tweetDetails = request.body
  const {tweet} = tweetDetails
  // console.log(tweet)
  const addTweetQuery = `INSERT INTO tweet(tweet,user_id)
  VALUES ('${tweet}', (SELECT user_id FROM user WHERE username='${request.username}'));`

  const dbResponse = await db.run(addTweetQuery)
  response.send('Created a Tweet')
})

// delete a tweet //
app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const tweetCheckQuery = `SELECT tweet.tweet FROM (user INNER JOIN follower on user.user_id = follower.follower_user_id) AS T
  INNER JOIN tweet on tweet.user_id = T.follower_user_id
  WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username='${request.username}') AND tweet.tweet_id = ${tweetId}`

    const tweetCheck = await db.get(tweetCheckQuery)

    console.log(tweetCheck)

    if (tweetCheck === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`

      await db.run(deleteTweetQuery)
      response.send('Tweet Removed')
    }
  },
)

module.exports = app
