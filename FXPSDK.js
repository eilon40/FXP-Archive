export class FXPSDK {
    constructor(baseURL = "http://localhost:8080") {
        this.baseURL = baseURL.replace(/\/$/, "");
    }

    async request(path, params = {}) {
        const url = new URL(path, this.baseURL);

        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                url.searchParams.set(key, value);
            }
        }

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(
                `FXP API error: ${response.status} ${response.statusText}`
            );
        }

        return response.json();
    }
    
    askAI(prompt) {
        return this.request("/ask-ai", {
            prompt,
            url: window.location.href
        });
    }

    home() {
        // Return admins, the latest thread for each forum, forums, and categories, including the thread count for each forum and its subforums.
        return this.request("/");
    }

    member(query) {
        return new Member(this, query);
    }

    // thread(query) {
    //     return new Thread(this, query);
    // }

    // private(query = {}) {
    //     return new Private(this, query);
    // }

    // forum(query) {
    //     return new Forum(this, query);
    // }
}

class Member {
    constructor(client, query = {}) {
        this.client = client;
        this.query = query;

        this.params = {
            u: this.query.userId,
            username: this.query.username,
        };
    }

    get() {
        /*
        {
          "user_id": 749522,
          "username": "Middleware",
          "role": "usermarkup respectuser",
          "is_online": false,
          "is_banned": false,
          "sex": "זכר",
          "avatar_url": "https://i.imagesup.co/images2/749522_31cdd167-5f74-4db7-97d8-e30575ae0059.jpg",
          "display_name": "",
          "join_date": "03-10-2011",
          "title": "🕯️ You'll always be remembered",
          "signature": "",
          "post_count": 11622,
          "like_count": 2272,
          "follower_count": 4,
          "biography": "",
          "interests": "",
          "profession": "",
          "marital_status": "לא פנוי/ה לקשר",
          "interested_in": "מוסתר",
          "residential_area": "",
          "city_residence": "",
          "friends_count": 0,
          "friend_messages_count": 0,
          "messages_per_day": 2.14,
          "last_seen": "16-08-2026 21:30",
          "home_page": "",
          "is_status_hidden": false,
          "can_pm": false,
          "friends": [],
          "messages": []
        }
        */
        return this.client.request("/member", this.params);
    }
    // Loading using infinite scroll or SPA 
    visitorMessages(page = 1, prePage = 10) {
        return this.client.request("/member", {
            ...this.params,
            tab: "visitor_messaging",
            page,
            pp: prePage,
        });
    }
    // Loading using infinite scroll or SPA
    friends(page = 1, prePage = 10) {
        return this.client.request("/member", {
            ...this.params,
            tab: "friends",
            page,
            pp: prePage,
        });
    }
}
