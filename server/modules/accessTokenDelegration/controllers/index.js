import clientProvider from "../../../../utils/clientProvider.js";

const generateDelegatedToken = async (scopes) =>{
    try{
        const shop = process.env.NODE_ENV == 'dev' ? 'swiss-local-dev.myshopify.com' : 'swiss-beauty-dev.myshopify.com';
        const {client} = await clientProvider.offline.graphqlClient({shop});
        const query = `mutation delegateAccessTokenCreate($input: DelegateAccessTokenInput!) {
                delegateAccessTokenCreate(input: $input) {
                    delegateAccessToken {
                        accessToken
                        createdAt
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }`;
        const variables = {
            input: {
                delegateAccessScope: scopes
            },
            expiresIn: 86400
        };
        const {data,extensions,errors} = await client.request(query,{variables});
        if(errors && errors.length > 0){
            throw new Error("Failed to generate access token " + errors.join(","));
        };
        return {
            token: data.delegateAccessTokenCreate?.delegateAccessToken?.accessToken,
            createdAt: data.delegateAccessTokenCreate?.delegateAccessToken?.createdAt
        }
    }catch(err){
        throw new Error("Failed to generate delegated token reason -->" + err.message)
    }
};
export {
    generateDelegatedToken
}