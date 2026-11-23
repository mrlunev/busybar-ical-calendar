# Connect your calendar to iCal Calendar

iCal Calendar reads a calendar from its iCal (.ics) link: a private address your calendar service gives you. No sign-in, no password: the link is the key.

Get the link from your service below, then open the BUSY Bar's web interface, go to **Apps, iCal Calendar**, and paste it into **Calendar 1**. A second and third calendar go into **Calendar 2** and **Calendar 3**. Close the app and start it again: it reads its settings when it starts.

- [Outlook, work or school (Microsoft 365)](#outlook-work-or-school-microsoft-365)
- [Outlook.com](#outlookcom)
- [Google Calendar](#google-calendar)
- [iCloud (Apple Calendar)](#icloud-apple-calendar)
- [Proton Calendar](#proton-calendar)
- [Fastmail](#fastmail)
- [Nextcloud](#nextcloud)
- [Other services](#other-services)
- [If it does not work](#if-it-does-not-work)

## Before you start

- **The link is a password.** Anyone who has it can read the whole calendar. Do not post it or send it in a chat. If it leaks, reset it: every service below lets you, and the old link stops working.
- **Choose full details** where the service asks. With "busy only" or "free/busy" the bar gets the times but no meeting names.
- **Changes arrive with a delay.** The app checks every 10 minutes (Settings, Check calendars every), and each service refreshes its link on its own schedule: from minutes to several hours.

## Outlook, work or school (Microsoft 365)

1. Open Outlook on the web: outlook.office.com.
2. Settings (the gear), **Calendar**, **Shared calendars**.
3. Under **Publish a calendar**, pick the calendar and **Can view all details**, then **Publish**.
4. Copy the **ICS** link (not HTML).

No **Publish a calendar** section, or only "Can view when I'm busy": your organization's administrator has limited publishing. Ask them, or use a personal calendar.

Outlook publishes three months back and three months ahead by default.

On firmware 1.4.1 the bar loses the last few kilobytes of a Microsoft 365 answer, so a long calendar may arrive without its furthest meetings. The app keeps everything up to the last meeting that arrived whole and shows "known until" with that date on the back display.

## Outlook.com

The same steps at outlook.live.com: Settings, **Calendar**, **Shared calendars**, **Publish a calendar**, **Can view all details**, **Publish**, copy the **ICS** link.

## Google Calendar

1. Open calendar.google.com on a computer (the phone app has no such setting).
2. Settings (the gear), then your calendar under **Settings for my calendars** on the left.
3. **Integrate calendar**, then copy **Secret address in iCal format**.

Not the "Public address": that one works only for a calendar made public to everyone.

No secret address in a work or school account: your Google Workspace administrator has hidden it. To reset the link: **Reset** next to the secret address.

## iCloud (Apple Calendar)

On iPhone or iPad:

1. Calendar, **Calendars** at the bottom.
2. The **(i)** next to the calendar.
3. Turn on **Public Calendar**, then **Share Link**, **Copy**.

Or on icloud.com/calendar: the share button next to the calendar, **Public Calendar**, **Copy Link**.

The link starts with `webcal://`: paste it as it is. iCloud shares full details only; anyone with the link sees meeting names.

## Proton Calendar

Paid plans only.

1. calendar.proton.me, Settings, **Calendars**.
2. Open the calendar, **Share with anyone**.
3. **Create link** with **Full view**, copy it.

Proton says changes can take up to 8 hours to reach the link.

## Fastmail

1. Settings, **Calendars**.
2. **Edit** next to the calendar.
3. **Publish** with **Full event details**, copy the **iCal** link.

## Nextcloud

1. Calendar app, the **...** menu next to the calendar.
2. **Share link**, then **Copy subscription link**.

The link must end with `?export`. Your Nextcloud must be reachable from the internet with a valid certificate: the bar cannot reach a server inside your home network or one with a self-signed certificate.

## Other services

- **Zoho, Yahoo, Teamup and others:** look for a link called iCal, ICS, "subscribe" or "publish". An organization's administrator may turn it off.
- **Notion Calendar and Calendly** have no link of their own: use the link of the Google or Outlook calendar they are connected to.
- **Exchange in your company's own network:** publishing is off by default, and the bar usually cannot reach the server.

## If it does not work

The back display names the calendar and what went wrong:

- **link no longer works:** the link was reset or the calendar unpublished. Get a new one.
- **not a calendar link:** the address gives a web page, not a calendar. Copy the iCal or ICS link, not the HTML one.
- **HTTP** and a number: the service refused the link. Check that you copied all of it.
- **Set the bar's time zone in its settings:** meeting times show in UTC until you do.

To try the app without a link, type `demo` into **Calendar 1**: a made-up week around the current time, no network needed.
