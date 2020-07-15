const axios = require("axios")
const crypto = require('crypto')

const dynamodb = require('../util/dynamodb')
const jobsForm = require("../blocks/jobsForm")
const notesForm = require('../blocks/notesForm')
const activateBlock = require('../blocks/activateJob')
const keyValue = require('../util/keyValue')
const { getUser } = require('../util/userProfiles')
const slackFormData = require('../util/slackFormData')

module.exports.listJobs = async (req, res) => {
  try {
    const currentUser = await getUser(req.body.user_id)

    const blocks = await module.exports.getJobs()
      .then(jobs => jobs.map(job => {
        let text = [
          {
            key: keyValue.categories,
            value: job.categories.map(x => keyValue[x]).reduce((acc, i) => `${acc}\n- ${i}`, '')
          },
          {
            key: keyValue.attendance,
            value: keyValue[job.attendance]
          },
          {
            key: keyValue.experience,
            value: keyValue[job.experience]
          },
          {
            key: keyValue.engagement,
            value: keyValue[job.engagement]
          },
          {
            key: keyValue.duration,
            value: keyValue[job.duration]
          },
          {
            key: keyValue.weekly_hours,
            value: keyValue[job.weekly_hours]
          },
          {
            key: keyValue.location_req,
            value: keyValue[job.location_req]
          },
          {
            key: keyValue.description,
            value: job.description.replace(/<[^>]*>?/gm, '').substr(0, 280) + '...'
          },
        ]

        if (currentUser.is_admin) {
          text.push({
            key: keyValue.rate_client,
            value: `$${job.rate_client}`
          })
        }

        const block = {
          type: "section",
          text: {
            type: "mrkdwn",
            text: text.reduce((acc, i) => acc + `*${i.key}*: ${i.value}\n`, '')
          },
        }

        let button = {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: `Apply for ${job.title}`,
              },
              value: job.key,
              action_id: "apply_btn",
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Recommend Applicant",
              },
              value: job.id,
              action_id: "recommend_btn",
            },
          ],
        }

        if (currentUser.is_admin) {
          button.elements.push({
            type: "button",
            text: {
              type: "plain_text",
              text: "Add Notes",
            },
            value: job.id,
            action_id: "add_job_notes",
          })

          button.elements.push({
            type: "button",
            text: {
              type: "plain_text",
              text: "Edit Job",
            },
            value: job.id,
            action_id: "edit_job",
          })
        }

        return [ block, button ]
      })
      .flatMap((v, i, a) => a.length - 1 !== i ? [v, { "type": "divider" }] : v)
      .flat()
    )

    res.send({ blocks: blocks })
  } catch (err) {
    if (err) return err
  }
}

module.exports.addJob = async job => {
  const date = new Date()
  const created = date.toISOString().split('T')[0]

  let item = slackFormData.get(job)
  item.id = crypto.createHash('md5').update(date).digest('hex').substring(0, 12)
  item.created = created

  let params = {
    TableName: "jobs",
    Item: item
  }

  return await dynamodb.put(params).promise()
}

module.exports.updateJob = async (job_id, values) => {
  const job = slackFormData.get(values)
  let params = {
    TableName: "jobs",
    Key: {
      id: job_id,
    },
    UpdateExpression: `set attendance = :attendance, categories = :categories, description = :description, #duration = :duration, engagement = :engagement, experience = :experience, location_req = :location_req, start_date = :start_date, title = :title, weekly_hours = :weekly_hours, rate_client = :rate_client, rate_esteemed = :rate_esteemed, #timezone = :timezone, skills = :skills`,
    ExpressionAttributeValues: {
      ':attendance': job.attendance,
      ':categories': job.categories,
      ':description': job.description,
      ':duration': job.duration,
      ':engagement': job.engagement,
      ':experience': job.experience,
      ':location_req': job.location_req,
      ':start_date': job.start_date,
      ':title': job.title,
      ':weekly_hours': job.weekly_hours,
      ':rate_client': job.rate_client,
      ':rate_esteemed': job.rate_esteemed,
      ':timezone': job.timezone,
      ':skills': job.skills,
    },
    ExpressionAttributeNames: {
      '#duration': 'duration',
      '#timezone': 'timezone'
    }
  }

  return await dynamodb.update(params).promise()
}

module.exports.addJobForm = async (req, res) => {
  const dialog = {
    token: process.env.SLACK_TOKEN_BOT,
    trigger_id: req.body.trigger_id,
    view: JSON.stringify({
      title: {
        type: "plain_text",
        text: "Add New Job",
      },
      type: "modal",
      callback_id: "add_job",
      submit: {
        type: "plain_text",
        text: "Create",
      },
      close: {
        type: "plain_text",
        text: "Cancel",
      },
      blocks: jobsForm,
    }),
  }

  await axios.post("https://slack.com/api/views.open", dialog, {
      headers: {
        Authorization: "Bearer " + process.env.SLACK_TOKEN_BOT,
        "Content-Type": "application/json",
      },
    })
    .then(data => res.send())
    .catch(e => {
      console.log("dialog.open call failed: %o", e)
    })

  res.send()
}

module.exports.editJobForm = async (trigger_id, job_id) => {
  try {
    const job = await module.exports.getJobs(job_id)

    const blocks = slackFormData.set(jobsForm, job)

    const dialog = {
      token: process.env.SLACK_TOKEN_BOT,
      trigger_id: trigger_id,
      view: JSON.stringify({
        title: {
          type: "plain_text",
          text: "Edit Jobs",
        },
        callback_id: `edit_job`,
        submit: {
          type: "plain_text",
          text: "Update",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        type: "modal",
        blocks: blocks,
        private_metadata: job_id,
      }),
    }

    return await axios.post("https://slack.com/api/views.open", dialog, {
        headers: {
          Authorization: "Bearer " + process.env.SLACK_TOKEN_BOT,
          "Content-Type": "application/json",
        },
      })
      .catch(e => {
        console.log("dialog.open call failed: %o", e)
      })
  } catch (err) {
    if (err) console.log(err)
  }
}

module.exports.addJobNoteForm = async (trigger_id, job_id) => {
  try {
    const dialog = {
      token: process.env.SLACK_TOKEN_BOT,
      trigger_id: trigger_id,
      view: JSON.stringify({
        title: {
          type: "plain_text",
          text: "Add Note",
        },
        callback_id: 'add_job_notes',
        submit: {
          type: "plain_text",
          text: "Add",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        type: "modal",
        blocks: notesForm,
        private_metadata: job_id,
      }),
    }

    return await axios.post("https://slack.com/api/views.open", dialog, {
        headers: {
          Authorization: "Bearer " + process.env.SLACK_TOKEN_BOT,
          "Content-Type": "application/json",
        },
      })
      .catch(e => {
        console.log("dialog.open call failed: %o", e)
      })
  } catch (err) {
    if (err) console.log(err)
  }
}

module.exports.updateNotes = async (job_id, user_id, values) => {
  date = new Date()
  let notes = [
    {
      user: user_id,
      date: date.toISOString(),
      note: slackFormData.get(values).notes,
    }
  ]

  const job = await module.exports.getJobs(job_id)
  if (job.notes) {
    notes.push(job.notes)
  }

  let params = {
    TableName: "jobs",
    Key: {
      id: job_id,
    },
    UpdateExpression: 'set notes = :notes',
    ExpressionAttributeValues: {
      ':notes': notes,
    },
  }

  return await dynamodb.update(params).promise()
}

module.exports.getJobs = async (item = null) => {
  try {
    let params = {
      TableName: 'jobs',
    }

    if (item !== null) {
      params.Key = { id: item }
      return await dynamodb.get(params).promise()
        .then(({ Item }) => Item)
        .catch(e => console.log(e))
    }
    else {
      return await dynamodb.scan(params).promise()
        .then(({ Items }) => Items)
        .catch(e => console.log(e))
    }

  } catch (e) {
    console.log(e)

    return { statusCode: 400, body: JSON.stringify(e) }
  }
}
