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
        return this.client.request("/member", this.params);
    }

    visitorMessages(page = 1, prePage = 10) {
        return this.client.request("/member", {
            ...this.params,
            tab: "visitor_messaging",
            page,
            pp: prePage,
        });
    }

    friends(page = 1, prePage = 10) {
        return this.client.request("/member", {
            ...this.params,
            tab: "friends",
            page,
            pp: prePage,
        });
    }
}
