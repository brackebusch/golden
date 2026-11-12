# Objective

I would like to build an application which enables users to “query” data without
knowing SQL and visualize it with various chart types.

# Technology

This is a simple web application (react/node everything in typescript) with a
single page and single route. It will only be run locally, and this is
greenfield so iteration is king. No need to build out tests.

# Behavior:

There are two user flows

1. user logs in with an AI provider (only using Claude for now) and then using a
   textbox describes the query they are looking to perform on the data -Example
   user flow: user is presented with a “login using your claude subscription”,
   after logging in they are prompted in a textbox to something of the effect of
   “What would you like to explore today?” Where a conversation can take place
   to understand data
2. Users build a query using a dynamically generated form and then fetch/view
   the data -Example user flow: User visits root `/` page selects which dataset
   they want to see and play with (searchable dropdown). Upon selecting the
   dataset there will be dynamically generated fields which they can modify to
   shape how they want to see the data, upon describing their request they click
   a button and then a visualization appears matching the query they generated.
   They can then make further changes to the query and “regenerate” the data as
   they interact with it.

# Requirements

1. User can type into a textbox to “chat” with an AI agent to run queries (auto
   populates form)
2. User can manually “build” a query using a form with dropdowns, multi-select,
   and text boxes
3. Data is rendered visually in a meaningful way which users can understand
4. Form for building a query dynamically generated based on chart type and data
   set.
5. UI is clean, looks good, and relatively simple
6. Charts can be interacted with, i.e. hovering over a line chart gives data
   points for where the cursor is

# Data

My current plan is to obtain all my data through https://data.wa.gov/ which uses
soda and it has an SDK (https://github.com/socrata/soda-js). It’s a bit easy to
run into their throttling limit, and there is a default limit of 1000 rows per
response, but it’s free and interesting data. I want users to be able to use
this app without an API key. If time permits I will work through enabling them
to set one up if they wish. For getting off the ground focus on a single data
set for testing and experimentation:
https://data.wa.gov/education/Earnings-for-Graduates-by-Institution/gmgy-gm47/about_data
the api endpoint for SODA3 is
https://data.wa.gov/api/v3/views/gmgy-gm47/query.json. Api documentation is
https://dev.socrata.com/foundry/data.wa.gov/gmgy-gm47 and dev portal is found at
https://dev.socrata.com/ An example ai conversation about this data might be
“Which schools in Washington state produce the highest earners?” The AI would
ideally prompt again to confirm “is this total number of graduates or as a
percentage of total student body?” I realize you can’t control the prompts, but
we want to give clear guidance to an AI agent as a sort of mini MCP that queries
shouldn’t be wasted and I want to understand the user’s question well before
taking any actions. Furthermore, there will likely be other data sets which
might be relevant to the question like earning growth across careers, average
debt after graduation affecting savings and savings/investment potential,
unemployment rates in a given field, and so on. Once this is working well we can
work on providing supporting other data sets and queries.

# General thoughts

While it might be neat to have a data set auto regenerate on any form field
change after the initial fetch, I feel like this could get messy as a user seeks
to make multiple changes and it’s shifting during each iteration – not to
mention the excessive network calls, so keep the chart unchanged until a user
clicks the “go/generate/fetch/[some other action button name]” button.

Given the many different data sets offered, this needs to be built data shape
agnostic. My current mental model is an initial fetch for dataset
columns/descriptions/types that then gives guardrails for the follow-up query
generation.

This is a greenfield project, and this round of development is MVP focused. I
want to make something which works well today and is simple in nature, without
too many “someday feature [foo] will be built” and the accompanying bloat that
goes with that mentality.

Things I can think of which need to be decided upon

1. data visualization library with charts (think https://visx.airbnb.tech/docs)
2. A UI design and layout. Note on this: my current thinking is a form of the
   left hand part of the page (1/4 vw), chart rendered on the right hand setion,
   and an AI conversation box below the chart
3. Network strategy

Below the line for today:

- users can manually generate queries, i.e. a way to “look under the hood” of
  how queries are being generated and enable them to manually code them
- the ability to “remember” previous queries
- adjusting the styling of the dataset (color pallet options etc)
- using a legend, users can filter the data or hide some fields (this should be
  done with the query builder)

# Next steps

Help me think through this project based on the details I have provided, and
once I have fully flushed out the spec for the project I’ll move onto building
out a plan, and then execution. It might be wise to do some research on existing
BI tools which offer similar features to glean some ideas for best/ideal
approaches to specific problems (they have already done the groundwork for
design and product which is useful, but that doesn’t necessarily mean their
approach is the best or correct approach).
